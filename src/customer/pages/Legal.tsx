import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppShell, BackHeader } from '../../components/AppShell';

const CONTACT = 'iwillmediaofficial@gmail.com';
const UPDATED = '9 October 2026';

function LegalPage({ title, other, children }: { title: string; other: ReactNode; children: ReactNode }) {
  return (
    <AppShell header={<BackHeader back="/" title={title} subtitle={`Last updated ${UPDATED}`} />}>
      <section className="section form-card legal">{children}</section>
      <p className="meta legal-links">
        {other} · <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </AppShell>
  );
}

const Mail = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

export function Privacy() {
  return (
    <LegalPage title="Privacy policy" other={<Link to="/terms">Terms of Service</Link>}>
      <p>
        IWILLFLY is a local shops, offers and Scratch &amp; Win app run by IWILLMEDIA in India. This page
        explains what we collect, why, and the choices you have. We follow India's Digital Personal Data
        Protection Act, 2023.
      </p>

      <h3>What we collect</h3>
      <ul>
        <li>
          <b>Account details:</b> your name, email, mobile number and home area. If you sign in with Google,
          we get your Google account name and email.
        </li>
        <li>
          <b>Location:</b> when you tap "use current location", your device's GPS is used to find your area
          and show the distance to shops. It is kept on your device; we save only the area you choose.
        </li>
        <li>
          <b>Bill photos</b> you upload to earn points, with the shop, date and amount. Photos are kept in
          private storage, seen only by our admins, and deleted about 90 days after the bill is checked.
        </li>
        <li>
          <b>UPI ID</b> you give us to cash out points.
        </li>
        <li>
          <b>Push notifications:</b> if you allow them, your browser's notification subscription.
        </li>
        <li>
          <b>Your activity:</b> saved shops, Scratch &amp; Win history, prizes won, points and messages you
          send to support.
        </li>
        <li>
          <b>Shop owners:</b> business name, contact numbers and shop details you add.
        </li>
      </ul>

      <h3>Why we use it</h3>
      <p>
        To run your account, show nearby shops and offers, run Scratch &amp; Win fairly (one play a day, in
        your area), check bills and pay out points, send the alerts you ask for, answer support and stop
        misuse.
      </p>

      <h3>Who can see it</h3>
      <ul>
        <li>
          <b>Shops:</b> when you win a prize, that shop sees your name and mobile number so they can hand it
          over.
        </li>
        <li>
          <b>IWILLFLY admins:</b> see account data for support, bill checks and payouts.
        </li>
        <li>
          <b>Service providers</b> that store data for us: Supabase (database and sign-in) and Cloudflare
          (hosting and image storage).
        </li>
      </ul>
      <p>
        We do <b>not</b> sell your data, and we do not use advertising trackers. We share data with
        authorities only when the law requires it.
      </p>

      <h3>Your choices</h3>
      <ul>
        <li>You can change your name, mobile number and area in the app.</li>
        <li>You can turn off location and notifications in your browser or phone settings.</li>
        <li>
          To see, correct or delete your account or data, email <Mail />. We reply within 30 days. Some
          records (such as paid-out points) may be kept as long as the law requires.
        </li>
      </ul>

      <h3>Security and children</h3>
      <p>
        Data is sent over HTTPS and access is limited by role. IWILLFLY is not meant for children under 18
        without a parent's consent.
      </p>

      <h3>Contact</h3>
      <p>
        IWILLMEDIA, India — <Mail />. If this policy changes, we update the date at the top.
      </p>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of Service" other={<Link to="/privacy">Privacy policy</Link>}>
      <p>
        These terms apply when you use IWILLFLY, run by IWILLMEDIA in India. By using the app you agree to
        them.
      </p>

      <h3>Using IWILLFLY</h3>
      <ul>
        <li>Give true details and keep your sign-in safe. One account per person.</li>
        <li>
          Shop listings, offers and prices come from shops. We try to keep them right but cannot promise it.
        </li>
      </ul>

      <h3>Scratch &amp; Win</h3>
      <ul>
        <li>
          Prizes are given by the shops, not by IWILLFLY, and are subject to availability and daily limits.
        </li>
        <li>
          You need a saved area to play, and can play once a day. Prizes must be collected from the shop.
        </li>
        <li>Prizes cannot be exchanged for cash unless the shop says so.</li>
      </ul>

      <h3>Points</h3>
      <p>
        Earning, expiry and cash-out rules are in the <Link to="/points/terms">Points Terms</Link>.
      </p>

      <h3>Shop owners</h3>
      <ul>
        <li>You are responsible for your listings, offers and prices being true and lawful.</li>
        <li>You must hand over Scratch &amp; Win prizes you offer to the winners who show them.</li>
        <li>Use winners' contact details only to hand over prizes.</li>
      </ul>

      <h3>Misuse</h3>
      <p>
        We may suspend or close accounts that cheat, use fake bills, create many accounts, harass others or
        break the law, and may cancel prizes or points gained this way.
      </p>

      <h3>Liability</h3>
      <p>
        IWILLFLY is provided "as is". We are not responsible for goods or services sold by shops. As far as
        the law allows, our liability is limited to the value of any points or prizes in question.
      </p>

      <h3>Law and contact</h3>
      <p>
        These terms are governed by the laws of India. Questions: <Mail />. We may update these terms and will
        change the date at the top.
      </p>
    </LegalPage>
  );
}
