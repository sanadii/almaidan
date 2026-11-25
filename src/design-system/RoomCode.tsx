import { useEffect, useState } from 'react';
import * as QRCode from 'qrcode';
import { useCopyStatus } from './StatusToast';
import './room-code.css';

export function RoomCode({ code, joinUrl, large = false, copyEnabled = true }: {
  code: string;
  joinUrl: string;
  large?: boolean;
  copyEnabled?: boolean;
}) {
  const [qr, setQr] = useState<{ url: string; image: string | null }>();
  const { copyText, localStatus } = useCopyStatus();

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(joinUrl, { errorCorrectionLevel: 'M', margin: 4, width: 320 })
      .then((image) => {
        if (active) setQr({ url: joinUrl, image });
      })
      .catch(() => {
        if (active) setQr({ url: joinUrl, image: null });
      });
    return () => { active = false; };
  }, [joinUrl]);

  return (
    <div className={`room-code${large ? ' room-code--large' : ''}`}>
      <div className="room-code__details">
        <p><span>رمز الغرفة</span><bdi dir="ltr">{code}</bdi></p>
        {copyEnabled && <>
          <button className="button button--secondary room-code__copy" onClick={() => void copyText(code, 'تم النسخ', 'ما قدرنا ننسخ الرمز.')} type="button">
            انسخ الرمز
          </button>
          {localStatus ? <span className="room-code__status" role="status">{localStatus}</span> : null}
        </>}
      </div>
      {qr?.url === joinUrl && qr.image === null ? (
        <p className="room-code__qr-error" role="status">ما قدرنا نعرض رمز الانضمام. استخدموا رمز الغرفة.</p>
      ) : (
        <div className="room-code__qr">
          {qr?.url === joinUrl && qr.image ? (
            <img alt="رمز QR للانضمام إلى الغرفة" height={320} src={qr.image} width={320} />
          ) : null}
        </div>
      )}
    </div>
  );
}
