import React from 'react'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { COMPANY_DOC, COMPANY_NAME, CITY_STATE, SUPPORT_EMAIL, TERMS_VERSION } from '../lib/site.js'

export default function Terms() {
  return (
    <>
      <Nav />
      <main className="wrap legal">
        <h1>Termos de Uso</h1>
        <p className="muted tiny">Versão {TERMS_VERSION} · Última atualização: {TERMS_VERSION}</p>

        <p>
          Estes Termos de Uso (“Termos”) regulam o acesso e o uso da plataforma <strong>{COMPANY_NAME}</strong>
          {' '}(“Plataforma”, “nós”), que oferece criação de vitrine/catálogo digital, link de bio e
          envio de pedidos por WhatsApp. Ao criar uma conta, você (“Usuário”, “você”) declara que leu,
          entendeu e aceitou integralmente estes Termos e a nossa Política de Privacidade.
        </p>

        <h2>1. Quem pode usar</h2>
        <p>
          É necessário ter no mínimo 18 anos e capacidade civil para contratar. Ao usar a Plataforma,
          você garante que as informações fornecidas são verdadeiras e que tem autorização para
          representar o negócio cadastrado.
        </p>

        <h2>2. Descrição do serviço</h2>
        <p>
          A Plataforma permite: (a) montar uma vitrine pública com produtos, fotos, preços e links;
          (b) compartilhar um link na bio de redes sociais; (c) receber pedidos organizados por
          WhatsApp; e (d) no plano pago, receber pagamentos via Pix na conta do Mercado Pago do próprio
          Usuário.
        </p>
        <p>
          A Plataforma é uma ferramenta de intermediação tecnológica. <strong>Não somos responsáveis
          pela relação de consumo entre o Usuário e seus clientes</strong>, nem pela qualidade,
          entrega, garantia, estoque ou legalidade dos produtos e serviços ofertados pelo Usuário.
        </p>

        <h2>3. Cadastro e segurança da conta</h2>
        <p>
          Você é responsável por manter a confidencialidade da sua senha e por todas as atividades
          realizadas na sua conta. Notifique-nos imediatamente em caso de uso não autorizado.
        </p>

        <h2>4. Planos, preços e pagamento</h2>
        <ul className="list">
          <li><strong>Grátis:</strong> limitações de recursos e de quantidade de produtos, conforme exibido no painel.</li>
          <li><strong>Plano Loja:</strong> cobrança de R$ 9,90 a cada 30 dias, avulsa ou por assinatura recorrente no cartão.</li>
          <li>Os pagamentos da assinatura são processados por provedores terceiros (ex.: Mercado Pago). Não armazenamos dados de cartão.</li>
          <li>O plano contratado permanece ativo até a data já paga, mesmo em caso de cancelamento da recorrência.</li>
        </ul>

        <h2>5. Cancelamento e direito de arrependimento</h2>
        <p>
          Você pode cancelar a assinatura a qualquer momento no próprio painel, sem multa. Nos termos
          do art. 49 do Código de Defesa do Consumidor, é possível solicitar o reembolso integral da
          primeira cobrança em até 7 (sete) dias corridos da contratação, desde que o serviço não tenha
          sido utilizado de forma que descaracterize a contratação. Solicitações devem ser feitas pelo
          e-mail {SUPPORT_EMAIL}.
        </p>

        <h2>6. Obrigações do Usuário</h2>
        <ul className="list">
          <li>Cumprir a legislação aplicável, incluindo o Código de Defesa do Consumidor e a LGPD.</li>
          <li>Não publicar conteúdo ilícito, ofensivo, enganoso, pirata ou que viole direitos de terceiros.</li>
          <li>Não usar a Plataforma para spam, fraude, produtos proibidos ou atividades ilegais.</li>
          <li>Manter corretos seus dados de contato, preços, prazos e formas de entrega.</li>
        </ul>

        <h2>7. Conteúdo e propriedade intelectual</h2>
        <p>
          O Usuário mantém a titularidade das fotos, textos e marcas que envia, e concede à Plataforma
          licença para exibi-los na vitrine. A marca, o código e o layout da Plataforma pertencem a
          {COMPANY_NAME} e não podem ser copiados sem autorização.
        </p>

        <h2>8. Suspensão e encerramento</h2>
        <p>
          Podemos suspender ou encerrar contas que violem estes Termos, a lei ou que representem risco
          à Plataforma ou a terceiros, com aviso quando possível. O Usuário pode excluir a conta a
          qualquer momento pelos canais de suporte.
        </p>

        <h2>9. Limitação de responsabilidade</h2>
        <p>
          A Plataforma é fornecida “como está”. Não garantimos operação ininterrupta ou livre de erros.
          Na máxima extensão permitida pela lei, não nos responsabilizamos por lucros cessantes, perdas
          indiretas ou por indisponibilidades de serviços de terceiros (Supabase, Mercado Pago, ImgBB,
          hospedagem, WhatsApp, entre outros).
        </p>

        <h2>10. Alterações destes Termos</h2>
        <p>
          Podemos atualizar estes Termos para refletir mudanças no serviço ou na lei. A versão vigente
          estará sempre nesta página, com a data de atualização. O uso contínuo após alterações
          significa concordância.
        </p>

        <h2>11. Legislação e foro</h2>
        <p>
          Estes Termos são regidos pelas leis brasileiras. Fica eleito o foro do domicílio do Usuário
          consumidor para dirimir eventuais conflitos, quando aplicável a legislação consumerista.
        </p>

        <h2>12. Contato</h2>
        <p>
          Dúvidas sobre estes Termos: {SUPPORT_EMAIL}.
          {COMPANY_DOC ? ` ${COMPANY_NAME}, CNPJ/CPF ${COMPANY_DOC}, ${CITY_STATE}.` : ` ${COMPANY_NAME}, ${CITY_STATE}.`}
        </p>
      </main>
      <Footer />
    </>
  )
}
