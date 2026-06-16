/**
 * THE BUSINESS PROFILE — the Business console's "Profile" tab. A business sets ONE public
 * identity (name · logo · banner · website · description), minted as a soulbound on-chain
 * `BusinessProfile` NFT for a flat $0.10 (PROFILE_FEE). Its logo + name drive the agents
 * directory row; its full card (banner + description + site) runs any ad slot the business
 * holds. Mint once, then edit; each write is the same $0.10 — a spam guard, NOT the 2% rake.
 *
 * NON-CUSTODIAL: the create/edit PTB is built PURE here, signed LOCALLY by the zkLogin
 * session, and Enoki-SPONSORED over the WS (runSponsored) — the $0.10 is a `tx.balance`
 * push to the treasury, the key never leaves the machine, Suize never signs the owner leg.
 */
import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Link as LinkIcon } from '../system';
import { CONSOLE } from './copy';
import { unfurlSite } from '../data/unfurl';
import { runSponsored, type SignTransaction } from '../data/sponsored';
import {
  buildCreateProfile,
  buildEditProfile,
  type BusinessProfileView,
  type ProfileFields,
} from '../data/profile';
import type { BuildClient } from '../data/sponsored';

const C = CONSOLE.profile;

const EMPTY: ProfileFields = {
  name: '',
  description: '',
  imageUrl: '',
  bannerUrl: '',
  website: '',
};

const toFields = (p: BusinessProfileView | null): ProfileFields =>
  p
    ? {
        name: p.name,
        description: p.description,
        imageUrl: p.imageUrl,
        bannerUrl: p.bannerUrl,
        website: p.website,
      }
    : { ...EMPTY };

export interface ProfileTabProps {
  /** the business's current profile (null until minted) */
  profile: BusinessProfileView | null;
  ownerAddress: string;
  client: BuildClient;
  signTransaction: SignTransaction;
  /** called with the executed digest after a successful mint/edit (reload the profile) */
  onSaved: (digest: string) => void;
}

export function ProfileTab({ profile, ownerAddress, client, signTransaction, onSaved }: ProfileTabProps) {
  const [form, setForm] = useState<ProfileFields>(() => toFields(profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof ProfileFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // The description (+ banner) come from the linked WEBSITE, never a custom field: when
  // the site changes the backend unfurls its <head> and we adopt its og:description /
  // og:image. Debounced; best-effort (a failure just leaves what's there).
  const [meta, setMeta] = useState<'idle' | 'loading' | 'done' | 'none'>('idle');
  useEffect(() => {
    const site = form.website.trim();
    if (!site || /\s/.test(site)) {
      setMeta('idle');
      return;
    }
    setMeta('loading');
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const m = await unfurlSite(site, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (!m) {
        setMeta('none');
        return;
      }
      // adopt the site's description (never wipe a good one with an empty result).
      setForm((f) => (m.description ? { ...f, description: m.description } : f));
      setMeta(m.description ? 'done' : 'none');
    }, 650);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [form.website]);

  const name = form.name.trim();
  const dirty = useMemo(() => {
    const base = toFields(profile);
    return (Object.keys(form) as (keyof ProfileFields)[]).some((k) => form[k].trim() !== base[k].trim());
  }, [form, profile]);
  const canSubmit = !busy && name.length > 0 && (profile ? dirty : true);

  async function submit() {
    if (!name) {
      setError(C.nameRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fields: ProfileFields = {
        name,
        description: form.description.trim(),
        imageUrl: form.imageUrl.trim(),
        bannerUrl: form.bannerUrl.trim(),
        website: form.website.trim(),
      };
      const tx = profile ? buildEditProfile(profile.id, fields) : buildCreateProfile(fields);
      const digest = await runSponsored({ tx, owner: ownerAddress, client, signTransaction });
      onSaved(digest);
    } catch (e) {
      setError((e as Error).message || 'Something went wrong — try again.');
    } finally {
      setBusy(false);
    }
  }

  const initial = (name || '·').slice(0, 1).toUpperCase();

  return (
    <div className="rd-prof">
      <section className="rd-secard rd-secard--prof">
        <div className="rd-secard__head">
          <span className="rd-secard__icon" aria-hidden="true">
            <BadgeCheck size={14} strokeWidth={2} />
          </span>
          <h3 className="rd-secard__title">{C.title}</h3>
          {profile ? <span className="rd-sec__meta rd-prof__live">{C.eyebrow}</span> : null}
        </div>
        <p className="rd-prof__blurb">{C.blurb}</p>

        <div className="rd-prof__grid">
          {/* ── the form ── */}
          <div className="rd-prof__form">
            <Field label={C.fields.name.label}>
              <input value={form.name} onChange={set('name')} placeholder={C.fields.name.placeholder} maxLength={64} />
            </Field>
            <Field label={C.fields.website.label} icon={<LinkIcon size={13} strokeWidth={2} aria-hidden />}>
              <input
                value={form.website}
                onChange={set('website')}
                placeholder={C.fields.website.placeholder}
                inputMode="url"
              />
            </Field>
            <Field label={C.fields.imageUrl.label}>
              <input value={form.imageUrl} onChange={set('imageUrl')} placeholder={C.fields.imageUrl.placeholder} />
            </Field>
            <Field label={C.fields.bannerUrl.label}>
              <input value={form.bannerUrl} onChange={set('bannerUrl')} placeholder={C.fields.bannerUrl.placeholder} />
            </Field>
            {/* description is DERIVED from the website (not a custom field) — read-only */}
            <div className="rd-prof__field">
              <span className="rd-label">{C.fields.description.label}</span>
              <div className="rd-prof__desc">
                {meta === 'loading' ? (
                  <span className="rd-prof__deschint rd-prof__deschint--load">{C.fields.description.fetching}</span>
                ) : form.description.trim() ? (
                  <>
                    <p className="rd-prof__desctext">{form.description.trim()}</p>
                    <span className="rd-prof__deschint">{C.fields.description.fromSite}</span>
                  </>
                ) : (
                  <span className="rd-prof__deschint">
                    {form.website.trim() ? C.fields.description.noneFound : C.fields.description.empty}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── the live preview ── */}
          <aside className="rd-prof__preview" aria-label={C.livePreview}>
            <span className="rd-label">{C.livePreview}</span>
            {/* the directory row preview — logo + name only, exactly what the directory shows */}
            <div className="rd-prof__dirrow">
              <span className="rd-prof__logo">
                {form.imageUrl ? (
                  <img src={form.imageUrl} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
                ) : (
                  <span aria-hidden="true">{initial}</span>
                )}
              </span>
              <span className="rd-prof__dirname">{name || C.fields.name.placeholder}</span>
            </div>
            {/* the ad card preview — banner + name + description */}
            <div className="rd-prof__adcard">
              <div className="rd-prof__banner">
                {form.bannerUrl ? (
                  <img src={form.bannerUrl} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
                ) : null}
              </div>
              <div className="rd-prof__adbody">
                <span className="rd-prof__logo rd-prof__logo--sm">
                  {form.imageUrl ? (
                    <img src={form.imageUrl} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  ) : (
                    <span aria-hidden="true">{initial}</span>
                  )}
                </span>
                <span className="rd-prof__adname">{name || C.fields.name.placeholder}</span>
                {form.description.trim() ? (
                  <span className="rd-prof__addesc">{form.description.trim()}</span>
                ) : null}
              </div>
            </div>
          </aside>
        </div>

        {error ? <p className="rd-prof__err">{error}</p> : null}

        <div className="rd-prof__foot">
          <span className="rd-prof__feenote">{profile ? C.mintedNote : C.feeNote}</span>
          <button type="button" className="rd-btn rd-btn--accent" disabled={!canSubmit} onClick={submit}>
            <BadgeCheck size={13} strokeWidth={2} aria-hidden />
            {busy ? C.minting : profile ? C.edit : C.mint}
          </button>
        </div>
      </section>
    </div>
  );
}

/** A labeled bordered input row — reuses the sheet field shell. */
function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="rd-prof__field">
      <span className="rd-label">{label}</span>
      <div className="rd-sheet__field">
        {icon ? <span className="rd-prof__fieldicon">{icon}</span> : null}
        {children}
      </div>
    </label>
  );
}
