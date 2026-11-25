import { useEffect } from 'react';
import { StatusArt, StatusHomeLink, StatusPage } from '../design-system/StatusPanel';
import { businessIdentity } from '../config/business-identity';

export function ContactRoute() {
  useEffect(() => { document.title = 'تواصل معنا | الميدان'; }, []);
  return (
    <StatusPage title="تواصل معنا" illustration={<StatusArt art="cloud" />} action={<StatusHomeLink />}>
      <p>للاستفسارات والدعم، راسلوا فريق {businessIdentity.name} على البريد الإلكتروني.</p>
      <p><a className="text-link" href={`mailto:${businessIdentity.supportEmail}`} dir="ltr">{businessIdentity.supportEmail}</a></p>
    </StatusPage>
  );
}
