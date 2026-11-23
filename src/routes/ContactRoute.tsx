import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { InternalHeader } from '../design-system/InternalHeader';
import { businessIdentity } from '../config/business-identity';

export function ContactRoute() {
  useEffect(() => { document.title = 'تواصل معنا | الميدان'; }, []);
  return (
    <main data-page-layout="wide" className="maydan-app maydan-public-page" id="main-content" tabIndex={-1}>
      <InternalHeader />
      <section className="maydan-credits" aria-labelledby="contact-title"><div>
        <p className="eyebrow">الميدان</p>
        <h1 id="contact-title">تواصل معنا</h1>
        <p>للاستفسارات والدعم، راسلوا فريق {businessIdentity.name} على البريد الإلكتروني:</p>
        <p><a href={`mailto:${businessIdentity.supportEmail}`} dir="ltr">{businessIdentity.supportEmail}</a></p>
        <p><Link className="button button--secondary" to="/">العودة إلى البداية</Link></p>
      </div></section>
    </main>
  );
}
