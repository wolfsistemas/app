// Configurações públicas do site.
// IMPORTANTE: antes de vender, preencha os dados da empresa (nome, CNPJ/CPF,
// e-mail e WhatsApp de suporte). Pode ser via variáveis VITE_* no .env.
// Estes dados aparecem no rodapé, nas páginas legais e nos canais de suporte.

export const PRODUCT_NAME = 'VitrineZap'

// Nome jurídico/fantasia que aparece no rodapé e nos Termos.
export const COMPANY_NAME = import.meta.env.VITE_COMPANY_NAME || 'VitrineZap'

// CNPJ (pessoa jurídica) ou CPF (MEI/pessoa física). Ex.: '00.000.000/0001-00'.
export const COMPANY_DOC = import.meta.env.VITE_COMPANY_DOC || ''

export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'suporte@vitrinezap.com'

// Somente dígitos com DDI/DDD. Ex.: '5511999999999'. Vazio esconde o botão.
export const SUPPORT_WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP || ''

export const CITY_STATE = import.meta.env.VITE_COMPANY_CITY || 'São Paulo/SP'

// Versão/última atualização dos documentos legais. Atualize ao revisar.
export const TERMS_VERSION = '2026-09-10'

export function whatsappSupportUrl(text) {
  if (!SUPPORT_WHATSAPP) return ''
  const base = `https://wa.me/${SUPPORT_WHATSAPP}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}
