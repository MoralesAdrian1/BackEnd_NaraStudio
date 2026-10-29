/** Plantillas de los correos: HTML sencillo con estilos en línea (lo que aceptan los clientes de correo). */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const money = (cents: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100);

export const when = (d: Date) =>
  new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);

const layout = (title: string, body: string) => `<!doctype html>
<html lang="es"><body style="margin:0;background:#f5efe9;font-family:Helvetica,Arial,sans-serif;color:#3b2d27">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;letter-spacing:.04em">NARA STUDIO</p>
    <div style="background:#fff;border-radius:20px;padding:28px">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25">${esc(title)}</h1>
      ${body}
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:#8a7a72">Nara Studio · Habita tu cuerpo</p>
  </div>
</body></html>`;

const p = (html: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${html}</p>`;

const rows = (items: [string, string][]) =>
  `<table style="width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:15px">${items
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#8a7a72">${esc(k)}</td>` +
        `<td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${esc(v)}</td></tr>`,
    )
    .join('')}</table>`;

const button = (href: string, label: string) =>
  `<p style="margin:20px 0 8px"><a href="${esc(href)}" style="display:inline-block;background:#9c5b43;color:#fff;` +
  `text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px">${esc(label)}</a></p>`;

export function invitation(name: string, link: string) {
  return {
    subject: 'Tu cuenta de Nara Studio está lista',
    html: layout(
      `¡Hola, ${name}!`,
      p('Tu coach te registró en Nara Studio. Crea tu contraseña para entrar a la app: ahí reservas tus clases y ves tu membresía y tu racha.') +
        button(link, 'Crear mi contraseña') +
        p('<small style="color:#8a7a72">Si el botón ya no funciona, entra a la app y elige “¿Olvidaste tu contraseña?” con este mismo correo.</small>'),
    ),
  };
}

export interface PurchaseInfo {
  studentName: string;
  planName: string;
  priceCents: number;
  /** La clase reservada con este pago, si hay */
  className?: string;
  classAt?: Date;
}

const purchaseRows = (x: PurchaseInfo) =>
  rows([
    ['Plan', x.planName],
    ['Total', money(x.priceCents)],
    ...(x.className && x.classAt ? [['Clase', `${x.className}, ${when(x.classAt)}`] as [string, string]] : []),
  ]);

/** A la alumna: pidió pagar en efectivo. */
export function cashRequested(x: PurchaseInfo) {
  return {
    subject: `Solicitud recibida: ${x.planName}`,
    html: layout(
      `¡Listo, ${x.studentName}!`,
      p('Recibimos tu solicitud con pago en efectivo.') +
        purchaseRows(x) +
        p(
          x.className
            ? '<b>Pagas el día que asistas</b>, al llegar a tu clase. Tu lugar ya está apartado.'
            : '<b>Pagas el día que asistas</b> a tu primera clase. Ya puedes reservarla en la app; al pagar se activan tus demás clases.',
        ),
    ),
  };
}

/** A las coaches del plan: una alumna pidió pagar en efectivo. */
export function cashRequestForCoach(x: PurchaseInfo) {
  return {
    subject: `Pago en efectivo pendiente: ${x.studentName}`,
    html: layout(
      'Nueva solicitud con pago en efectivo',
      p(`<b>${esc(x.studentName)}</b> pidió un plan y lo paga el día que asista.`) +
        purchaseRows(x) +
        p('Cóbrale al pasar lista con “Asistencia y pago”, o en “Pagos en efectivo”.'),
    ),
  };
}

interface PaidInfo extends PurchaseInfo {
  paidAt: Date;
  receivedBy: string;
  method: string;
}

/** A la alumna: su recibo. */
export function receipt(x: PaidInfo) {
  return {
    subject: `Recibo de pago: ${x.planName}`,
    html: layout(
      `Gracias, ${x.studentName}`,
      p('Recibimos tu pago y tu plan ya está activo.') +
        rows([
          ['Plan', x.planName],
          ['Total pagado', money(x.priceCents)],
          ['Forma de pago', x.method],
          ['Fecha', when(x.paidAt)],
          ['Recibió', x.receivedBy],
        ]) +
        p('Guarda este correo como comprobante.'),
    ),
  };
}

/** A las coaches del plan: entró un pago. */
export function paymentForCoach(x: PaidInfo) {
  return {
    subject: `Pago recibido: ${x.studentName} · ${money(x.priceCents)}`,
    html: layout(
      'Se registró un pago',
      p(`<b>${esc(x.studentName)}</b> pagó y su plan está activo.`) +
        rows([
          ['Plan', x.planName],
          ['Total', money(x.priceCents)],
          ['Forma de pago', x.method],
          ['Recibió', x.receivedBy],
          ['Fecha', when(x.paidAt)],
        ]),
    ),
  };
}
