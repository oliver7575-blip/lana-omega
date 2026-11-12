/** Wording of the approved hello templates (client-safe: no server imports). {{1}} = first name, {{2}} = reason. */
export const HELLO_TEXT = {
  es: (n: string, r: string) => `Hola ${n}, te saludamos desde Soirée, en Zipolite! 🌴\n\n${r}\n\nEste es nuestro contacto directo por WhatsApp: escríbenos por aquí cuando lo necesites.`,
  en: (n: string, r: string) => `Hi ${n}, this is Soirée in Zipolite! 🌴\n\n${r}\n\nThis is our direct WhatsApp contact: feel free to message us here whenever you need.`,
} as const
