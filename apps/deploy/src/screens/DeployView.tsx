import { useCallback, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DeployResponse } from '@suize/shared'
import { deploy_site } from '../api'
import {
  files_to_pack,
  normalize_entry_path,
  pack_tar,
  total_bytes,
  type PackFile,
} from '../pack'
import { fmt_bytes } from '../format'
import {
  CopyButton,
  EmptyState,
  describe_error,
  IconBack,
  IconExternal,
  IconPress,
} from '../ui'

// ============================================================================
// DEPLOY (manual) — drag-drop a BUILT static folder (or pick one), pack it into
// a single `site.tar` client-side (src/pack.ts), POST /deploy (the SAME route
// agents use), and show the resulting live URL. For humans testing; the agent
// path POSTs a tar directly. Real upload; honest empty/error states.
// ============================================================================

// Walk a dropped directory entry tree into { file, path } pairs (drag-drop only
// exposes FileSystemEntry; <input webkitdirectory> gives webkitRelativePath).
const read_dir_entry = (
  entry: FileSystemEntry,
  base: string,
  out: { file: File; path: string }[],
): Promise<void> =>
  new Promise(resolve => {
    if (entry.isFile) {
      ;(entry as FileSystemFileEntry).file(f => {
        out.push({ file: f, path: `${base}${entry.name}` })
        resolve()
      }, () => resolve())
      return
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const all: FileSystemEntry[] = []
      const readBatch = () =>
        reader.readEntries(
          batch => {
            if (batch.length === 0) {
              // drain all children, then recurse
              Promise.all(
                all.map(e =>
                  read_dir_entry(e, `${base}${entry.name}/`, out),
                ),
              ).then(() => resolve())
              return
            }
            all.push(...batch)
            readBatch()
          },
          () => resolve(),
        )
      readBatch()
    } else {
      resolve()
    }
  })

export const DeployView = ({
  owner,
  onBack,
  onOpen,
  onError,
  onDeployed,
}: {
  owner: string | null
  onBack: () => void
  onOpen: (siteId: string) => void
  onError: (msg: string) => void
  onDeployed: (msg: string) => void
}) => {
  const [files, setFiles] = useState<PackFile[]>([])
  const [name, setName] = useState('')
  const [over, setOver] = useState(false)
  const [result, setResult] = useState<DeployResponse | null>(null)
  const dirInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const ingest = useCallback(
    async (picked: { file: File; path: string }[]) => {
      const packed = await files_to_pack(picked)
      // Guess a default name from the dropped root folder if none typed.
      if (packed.length > 0) {
        const firstRaw = picked[0]?.path ?? ''
        const root = firstRaw.replace(/\\/g, '/').split('/')[0]
        setName(prev => prev || root || 'my-site')
      }
      setFiles(packed)
      setResult(null)
    },
    [],
  )

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      const items = Array.from(e.dataTransfer.items)
      const out: { file: File; path: string }[] = []
      const entries = items
        .map(it => it.webkitGetAsEntry?.())
        .filter((x): x is FileSystemEntry => Boolean(x))
      if (entries.length > 0) {
        await Promise.all(entries.map(en => read_dir_entry(en, '', out)))
      } else {
        // Fallback: plain files with no directory structure.
        for (const f of Array.from(e.dataTransfer.files))
          out.push({ file: f, path: f.name })
      }
      await ingest(out)
    },
    [ingest],
  )

  const onPickDir = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = Array.from(e.target.files ?? [])
      await ingest(
        list.map(f => ({
          file: f,
          // webkitdirectory carries the folder path on webkitRelativePath.
          path:
            (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
            f.name,
        })),
      )
    },
    [ingest],
  )

  const onPickFiles = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = Array.from(e.target.files ?? [])
      // Picked loose files have no folder wrapper; keep their bare names but DON'T
      // strip a segment (normalize would otherwise drop the only segment).
      await ingest(list.map(f => ({ file: f, path: `root/${f.name}` })))
    },
    [ingest],
  )

  const m = useMutation({
    mutationFn: () => {
      const tar = pack_tar(files)
      return deploy_site({
        name: name.trim() || 'my-site',
        site_tar: tar,
        owner,
      })
    },
    onSuccess: res => {
      setResult(res)
      onDeployed(`Deployed → ${res.subdomain}`)
      void qc.invalidateQueries({ queryKey: ['sites'] })
    },
    onError: e => onError(describe_error(e).title),
  })

  const size = total_bytes(files)
  const hasIndex = files.some(f => normalize_entry_path(f.path) === 'index.html')

  return (
    <>
      <button type="button" className="dx-back" onClick={onBack}>
        <IconBack /> All sites
      </button>

      <div className="dx-pagehead">
        <div>
          <p className="ed-eyebrow">Manual deploy</p>
          <h1 className="dx-pagehead__title">Press an edition</h1>
        </div>
      </div>

      {result ? (
        <div className="dx-panel">
          <h2 className="dx-panel__title">Pressed</h2>
          <EmptyState
            kicker="Edition pressed"
            title="Your edition is live"
            body={
              <>
                It's served from Walrus at the free subdomain below. Each press is
                immutable — a re-deploy mints a fresh edition at a new URL.
              </>
            }
          />
          <div className="dx-rows" style={{ marginTop: 16 }}>
            <div className="dx-row">
              <span className="dx-row__k">Live URL</span>
              <span className="dx-row__v">
                <a href={result.url} target="_blank" rel="noreferrer">
                  {result.url.replace(/^https?:\/\//, '')}
                </a>{' '}
                <CopyButton value={result.url} label="Copy URL" />
              </span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Subdomain</span>
              <span className="dx-row__v">{result.subdomain}</span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Version</span>
              <span className="dx-row__v">{result.version}</span>
            </div>
            <div className="dx-row">
              <span className="dx-row__k">Tx digest</span>
              <span className="dx-row__v" title={result.digest}>
                {result.digest.slice(0, 10)}…{' '}
                <CopyButton value={result.digest} label="Copy digest" />
              </span>
            </div>
          </div>
          <div className="dx-form-actions">
            <a
              className="dx-btn is-accent"
              href={result.url}
              target="_blank"
              rel="noreferrer"
            >
              <IconExternal /> Visit site
            </a>
            <button
              type="button"
              className="dx-btn"
              onClick={() => onOpen(result.siteId)}
            >
              Open detail
            </button>
            <button
              type="button"
              className="dx-btn is-ghost"
              onClick={() => {
                setResult(null)
                setFiles([])
                setName('')
              }}
            >
              Deploy another
            </button>
          </div>
        </div>
      ) : (
        <div className="dx-panel">
          <label className="dx-label" htmlFor="site-name">
            Site name
          </label>
          <input
            id="site-name"
            className="dx-field"
            type="text"
            placeholder="my-site"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ marginBottom: 18 }}
          />

          <div
            className={`dx-drop${over ? ' is-over' : ''}`}
            onDragOver={e => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            onClick={() => dirInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ')
                dirInput.current?.click()
            }}
          >
            <span className="dx-drop__plate" aria-hidden="true">
              <IconPress />
            </span>
            <p className="dx-drop__title">Feed the press</p>
            <p className="dx-drop__body">
              Drop your pre-built static output (e.g. <code>dist/</code> or{' '}
              <code>build/</code>) onto the platen. No build step runs — we press
              exactly what you drop. Click to pick a folder instead.
            </p>
            <div className="dx-form-actions" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                className="dx-btn is-sm"
                onClick={() => dirInput.current?.click()}
              >
                Pick folder
              </button>
              <button
                type="button"
                className="dx-btn is-sm"
                onClick={() => fileInput.current?.click()}
              >
                Pick files
              </button>
            </div>
          </div>

          {/* hidden inputs: a directory picker + a loose-file picker */}
          <input
            ref={dirInput}
            type="file"
            // @ts-expect-error — webkitdirectory is a non-standard but widely
            // supported attribute for picking a whole folder.
            webkitdirectory=""
            directory=""
            multiple
            hidden
            onChange={onPickDir}
          />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={onPickFiles}
          />

          {files.length > 0 && (
            <>
              <div className="ed-sep" style={{ margin: '20px 0 12px' }}>
                <span className="ed-sep__label">The galley</span>
                <span className="ed-sep__line" />
                <span className="dx-pagehead__count tnum">
                  {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
                  {fmt_bytes(size)}
                </span>
              </div>
              <div className="dx-filelist">
                {files.map(f => (
                  <div key={f.path} className="dx-filerow">
                    <span className="dx-filerow__path">/{f.path}</span>
                    <span className="dx-filerow__size">
                      {fmt_bytes(f.bytes.length)}
                    </span>
                  </div>
                ))}
              </div>

              {!hasIndex && (
                <p className="dx-error">
                  No <code>index.html</code> at the root — most static hosts
                  serve that by default. Make sure you dropped the folder
                  contents, not its parent.
                </p>
              )}

              <div className="dx-form-actions">
                <button
                  type="button"
                  className="dx-btn is-accent"
                  disabled={m.isPending}
                  onClick={() => m.mutate()}
                >
                  {m.isPending ? 'Pressing…' : 'Press to Walrus'}
                </button>
                <button
                  type="button"
                  className="dx-btn is-ghost"
                  disabled={m.isPending}
                  onClick={() => setFiles([])}
                >
                  Clear
                </button>
              </div>

              {m.isError && (
                <p className="dx-error">{describe_error(m.error).title}</p>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
