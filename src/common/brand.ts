/**
 * Marca del estudio para los correos. Cada despliegue (un estudio) la configura con variables de
 * entorno; sin ellas quedan los valores de Nara Studio.
 */
export const brand = () => ({
  name: process.env.STUDIO_NAME || 'Nara Studio',
  slogan: process.env.STUDIO_SLOGAN ?? 'Habita tu cuerpo',
  colors: {
    bg: process.env.MAIL_COLOR_BG || '#f5efe9',
    ink: process.env.MAIL_COLOR_INK || '#3b2d27',
    accent: process.env.MAIL_COLOR_ACCENT || '#9c5b43',
  },
});
