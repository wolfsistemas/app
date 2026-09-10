import React from 'react'
import { Link } from 'react-router-dom'
import Brand from './Brand.jsx'
import {
  COMPANY_DOC,
  COMPANY_NAME,
  PRODUCT_NAME,
  SUPPORT_EMAIL,
  SUPPORT_WHATSAPP,
  whatsappSupportUrl
} from '../lib/site.js'

export default function Footer({ onDark = false }) {
  const year = new Date().getFullYear()
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <div className="stack" style={{ gap: 8 }}>
          <Brand onDark={onDark} />
          <p className="tiny muted" style={{ margin: 0, maxWidth: '32ch' }}>
            Catálogo + bio link para quem vende no WhatsApp. Pedido pronto, pagamento na sua conta.
          </p>
        </div>
        <div className="footer-col">
          <strong className="tiny">{PRODUCT_NAME}</strong>
          <Link to="/criar">Criar vitrine grátis</Link>
          <Link to="/entrar">Entrar</Link>
          <a href={`${import.meta.env.BASE_URL}#preco`}>Preço</a>
        </div>
        <div className="footer-col">
          <strong className="tiny">Legal</strong>
          <Link to="/termos">Termos de Uso</Link>
          <Link to="/privacidade">Política de Privacidade</Link>
        </div>
        <div className="footer-col">
          <strong className="tiny">Suporte</strong>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          {SUPPORT_WHATSAPP && (
            <a href={whatsappSupportUrl('Olá! Preciso de ajuda com o VitrineZap.')} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          )}
        </div>
      </div>
      <div className="wrap between" style={{ marginTop: 22, flexWrap: 'wrap', gap: 8 }}>
        <span className="tiny muted">
          © {year} {COMPANY_NAME}. Todos os direitos reservados.
        </span>
        {COMPANY_DOC && <span className="tiny muted">CNPJ/CPF: {COMPANY_DOC}</span>}
      </div>
    </footer>
  )
}
