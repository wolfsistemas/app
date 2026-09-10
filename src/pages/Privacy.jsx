import React from 'react'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import { COMPANY_DOC, COMPANY_NAME, CITY_STATE, SUPPORT_EMAIL, TERMS_VERSION } from '../lib/site.js'

export default function Privacy() {
  return (
    <>
      <Nav />
      <main className="wrap legal">
        <h1>Política de Privacidade</h1>
        <p className="muted tiny">Versão {TERMS_VERSION} · Última atualização: {TERMS_VERSION}</p>

        <p>
          Esta Política explica como <strong>{COMPANY_NAME}</strong> (“nós”) trata dados pessoais na
          plataforma VitrineZap, em conformidade com a Lei Geral de Proteção de Dados (Lei nº
          13.709/2018 — LGPD). Ao usar a Plataforma, você declara estar ciente das práticas abaixo.
        </p>

        <h2>1. Quem é o controlador</h2>
        <p>
          O controlador dos dados é {COMPANY_NAME}
          {COMPANY_DOC ? `, CNPJ/CPF ${COMPANY_DOC}` : ''}, {CITY_STATE}. Contato do encarregado
          (DPO): {SUPPORT_EMAIL}.
        </p>

        <h2>2. Dados que tratamos</h2>
        <ul className="list">
          <li><strong>Dados do lojista:</strong> nome, e-mail, senha (armazenada de forma criptografada pelo provedor de autenticação), WhatsApp, Instagram e dados da loja.</li>
          <li><strong>Dados dos clientes finais</strong> (inseridos pelo lojista no checkout): nome, telefone, e-mail e observações do pedido.</li>
          <li><strong>Dados de pedidos:</strong> itens, valores, status de pagamento e código do pedido.</li>
          <li><strong>Dados de pagamento:</strong> identificadores de transação e status. <strong>Não armazenamos números de cartão.</strong> O processamento é feito pelo Mercado Pago.</li>
          <li><strong>Dados técnicos:</strong> endereço IP, tipo de navegador, registros de acesso e assinaturas de notificação push (endpoint do navegador).</li>
        </ul>

        <h2>3. Para que usamos (finalidades e bases legais)</h2>
        <ul className="list">
          <li>Criar e operar sua conta e sua vitrine — execução de contrato (art. 7º, V).</li>
          <li>Processar pedidos e pagamentos — execução de contrato.</li>
          <li>Enviar avisos do serviço (pedido pago, status, suporte) — execução de contrato e legítimo interesse (art. 7º, IX).</li>
          <li>Cumprir obrigações legais, fiscais e regulatórias — art. 7º, II.</li>
          <li>Segurança, prevenção a fraudes e melhoria do produto — legítimo interesse.</li>
          <li>Comunicações de marketing, quando aplicável — consentimento, cancelável a qualquer momento.</li>
        </ul>

        <h2>4. Compartilhamento com terceiros</h2>
        <p>Usamos operadores que tratam dados em nosso nome, com finalidades específicas:</p>
        <ul className="list">
          <li><strong>Supabase</strong> — autenticação, banco de dados e armazenamento.</li>
          <li><strong>Mercado Pago</strong> — processamento de pagamentos (assinatura e Pix).</li>
          <li><strong>ImgBB</strong> — armazenamento de imagens enviadas.</li>
          <li><strong>Provedores de hospedagem, e-mail e notificações push</strong> — infraestrutura e envio de mensagens.</li>
        </ul>
        <p>
          Também podemos compartilhar dados para cumprir ordem judicial ou obrigação legal. Não
          vendemos dados pessoais.
        </p>

        <h2>5. Transferência internacional</h2>
        <p>
          Alguns provedores podem armazenar dados fora do Brasil. Nesses casos, buscamos garantias
          contratuais adequadas de proteção, conforme a LGPD.
        </p>

        <h2>6. Cookies e medição</h2>
        <p>
          Usamos cookies e armazenamento local essenciais ao funcionamento (sessão, preferências e
          pedidos recentes). Eventualmente podemos usar analytics para entender o uso e melhorar o
          serviço.
        </p>

        <h2>7. Retenção e exclusão</h2>
        <p>
          Mantemos os dados enquanto a conta existir ou pelo tempo necessário ao cumprimento de
          obrigações legais. Ao excluir a conta, os dados são eliminados ou anonimizados, ressalvadas
          as hipóteses de guarda obrigatória.
        </p>

        <h2>8. Seus direitos (art. 18 da LGPD)</h2>
        <p>
          Você pode solicitar: confirmação de tratamento, acesso, correção, anonimização, bloqueio ou
          eliminação, portabilidade, informação sobre compartilhamentos e revogação do consentimento.
          Fale com {SUPPORT_EMAIL}. Responderemos nos prazos legais.
        </p>

        <h2>9. Dados de clientes finais</h2>
        <p>
          Ao cadastrar dados dos seus clientes, <strong>o lojista é o controlador</strong> desses dados
          e nós atuamos como operadores. O lojista é responsável por ter base legal e informar seus
          clientes sobre o uso dos dados.
        </p>

        <h2>10. Segurança</h2>
        <p>
          Adotamos medidas técnicas e administrativas razoáveis, como autenticação, controle de acesso
          por linha (RLS), criptografia em trânsito (HTTPS) e restrição de credenciais. Nenhum sistema
          é 100% seguro; em caso de incidente relevante, comunicaremos os titulares e a ANPD conforme
          a lei.
        </p>

        <h2>11. Alterações desta Política</h2>
        <p>
          Podemos atualizar esta Política. A versão vigente fica sempre nesta página, com a data de
          atualização.
        </p>

        <h2>12. Contato</h2>
        <p>Encarregado de dados (DPO): {SUPPORT_EMAIL}.</p>
      </main>
      <Footer />
    </>
  )
}
