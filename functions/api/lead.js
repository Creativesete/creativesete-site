// Cloudflare Pages Function: recebe os pedidos do site.
// 1) Cria uma ficha no Notion (CRM — Clientes & Prospects).
// 2) (Opcional) So os pedidos do guia gratuito vao para o MailerLite, que envia
//    o guia e a newsletter. Pedidos de orcamento nunca vao.
//
// Variaveis de ambiente:
//   NOTION_TOKEN            (obrigatorio) secret da integracao Notion
//   NOTION_DB              (opcional) id da base; ja tem valor por defeito
//   MAILERLITE_TOKEN        (opcional) API key do MailerLite
//   MAILERLITE_GROUP_GUIA   (opcional) id do grupo que dispara o envio do guia
//   MAILERLITE_GROUP_NEWS   (opcional) id do grupo da newsletter semanal
//   FORMSPREE_URL           (opcional) endpoint Formspree para o aviso de novo lead; ja tem valor por defeito
//
// 3) Envia um aviso por email a equipa (Formspree) para pedidos de orcamento/contacto.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost({ request, env }) {
  try {
    const ct = request.headers.get('content-type') || '';
    let d = {};
    if (ct.includes('application/json')) {
      d = await request.json();
    } else {
      const fd = await request.formData();
      for (const [k, v] of fd) d[k] = v;
    }

    // honeypot anti-spam
    if ((d._gotcha || '').toString().trim() !== '') {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const s = (x, n) => (x == null ? '' : x.toString().trim().slice(0, n));
    const nome = s(d.nome, 200) || 'Sem nome';
    const email = s(d.email, 200);
    const telefone = s(d.telefone, 60);
    const mensagem = s(d.mensagem, 1800);

    // Campos de qualificacao vindos do formulario do site.
    const empresa = s(d.empresa, 200);
    // 'pt' ou 'en', vem do atributo lang da pagina. Diz em que lingua responder.
    const idioma = s(d.idioma, 5).toLowerCase() === 'en' ? 'en' : 'pt';
    const tipo = s(d.tipo, 60);
    const orcamento = s(d.orcamento, 40);
    // A data chega do <input type="date"> como AAAA-MM-DD. So aceitamos esse formato.
    const dataProjeto = /^\d{4}-\d{2}-\d{2}$/.test(s(d.data, 10)) ? s(d.data, 10) : '';

    // ---- Triagem ------------------------------------------------------------
    // A mesma regra que corre no site, repetida aqui porque o browser nao e de
    // confianca. E este valor, e nao o do cliente, que vai para o CRM.
    //   B · vale reuniao      A · so quer preco      C · ainda nao decidiu
    const TIPOS_REUNIAO = ['Evento corporativo', 'Vídeo institucional',
      'Transmissão em direto', 'Curso online ou formação', 'Podcast'];
    const rota = (() => {
      if (orcamento === '3.000€ a 6.000€' || orcamento === 'Mais de 6.000€') return 'B';
      if (orcamento === 'Até 1.000€') return 'A';
      if (TIPOS_REUNIAO.includes(tipo)) return 'B';
      if (orcamento === 'Ainda não sei' && !empresa) return 'C';
      return 'A';
    })();
    const ROTA_NOME = { A: 'A · Preço', B: 'B · Reunião', C: 'C · Nutrição' };
    const rotaNome = ROTA_NOME[rota];

    // Pedido: "Orçamento" | "Guia gratuito" | "Contacto"
    let pedido = s(d.pedido, 40);
    if (!['Orçamento', 'Guia gratuito', 'Contacto'].includes(pedido)) pedido = 'Contacto';
    const isGuia = pedido === 'Guia gratuito';

    const assunto = s(d._subject, 200) || ('Pedido do site · ' + pedido);
    // As notas levam sempre tudo. Se o Notion ainda nao tiver as propriedades novas,
    // a informacao de qualificacao fica na mesma guardada aqui.
    const linhas = [assunto, 'Rota: ' + rotaNome, 'Idioma: ' + (idioma === 'en' ? 'Inglês' : 'Português')];
    if (empresa) linhas.push('Empresa: ' + empresa);
    if (tipo) linhas.push('Tipo de projeto: ' + tipo);
    if (dataProjeto) linhas.push('Data prevista: ' + dataProjeto);
    if (orcamento) linhas.push('Orcamento: ' + orcamento);
    if (mensagem) linhas.push('Mensagem: ' + mensagem);
    const notas = linhas.join(' · ').slice(0, 1900);
    const hoje = new Date().toISOString().slice(0, 10);

    if (!env.NOTION_TOKEN) {
      return new Response('NOTION_TOKEN em falta', { status: 500, headers: CORS });
    }

    // ---- 1) Notion CRM ----
    const props = {
      'Nome': { title: [{ text: { content: nome } }] },
      'Fonte': { select: { name: 'Site' } },
      'Tipo': { select: { name: isGuia ? 'Lead Frio' : 'Prospect' } },
      'Pedido': { select: { name: pedido } },
      'Notas': { rich_text: [{ text: { content: notas } }] },
      'Última Interação': { date: { start: hoje } },
    };
    if (email) props['Email'] = { email };
    if (telefone) props['Telefone'] = { phone_number: telefone };

    // Propriedades de qualificacao. So existem no Notion depois de serem criadas la.
    // Por isso tentamos primeiro com elas e, se o Notion recusar, repetimos sem elas.
    // Assim o lead nunca se perde e, no dia em que as propriedades existirem,
    // passam a ser preenchidas sem mexer neste ficheiro.
    const extra = {};
    if (empresa) extra['Empresa'] = { rich_text: [{ text: { content: empresa } }] };
    if (tipo) extra['Tipo de Projeto'] = { select: { name: tipo } };
    if (orcamento) extra['Orçamento'] = { select: { name: orcamento } };
    if (dataProjeto) extra['Data do Projeto'] = { date: { start: dataProjeto } };
    if (!isGuia) extra['Rota'] = { select: { name: rotaNome } };
    extra['Idioma'] = { select: { name: idioma === 'en' ? 'Inglês' : 'Português' } };

    const DB = env.NOTION_DB || 'bad23aa9-3823-4814-a6e3-72aa0e59e548';
    const criarPagina = (properties) => fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.NOTION_TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: DB }, properties }),
    });

    let r = await criarPagina(Object.keys(extra).length ? { ...props, ...extra } : props);

    if (!r.ok && Object.keys(extra).length) {
      // Muito provavelmente uma propriedade que ainda nao existe na base.
      // Repete so com o conjunto seguro; as notas ja levam a qualificacao toda.
      r = await criarPagina(props);
    }

    if (!r.ok) {
      const t = await r.text();
      return new Response('Notion error: ' + t, { status: 502, headers: CORS });
    }

    // ---- 2) MailerLite (best-effort: nunca falha o pedido) ----
    // SO para quem pede o guia. E o unico formulario do site que pede
    // consentimento ("Sem spam. So o guia e, de vez em quando, uma dica util").
    // Quem pede orcamento fica no CRM e no aviso por email, e nunca entra numa
    // lista de marketing. Nao mexer nesta condicao sem mudar o texto do site.
    if (isGuia && email && env.MAILERLITE_TOKEN) {
      const groups = [];
      if (env.MAILERLITE_GROUP_GUIA) groups.push(env.MAILERLITE_GROUP_GUIA);
      if (env.MAILERLITE_GROUP_NEWS) groups.push(env.MAILERLITE_GROUP_NEWS);
      try {
        await fetch('https://connect.mailerlite.com/api/subscribers', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + env.MAILERLITE_TOKEN,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            email,
            fields: { name: nome, idioma: idioma },
            groups,
          }),
        });
      } catch (_) { /* ignora falhas de email para nao bloquear o lead */ }
    }

    // ---- 3) Aviso por email a equipa (Formspree). So para orcamento/contacto (leads que pedem resposta). ----
    if (pedido !== 'Guia gratuito') {
      const FS = env.FORMSPREE_URL || 'https://formspree.io/f/xgaeobad';
      try {
        await fetch(FS, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            _subject: 'Lead ' + rota + (idioma === 'en' ? ' · EN' : '') + ' · ' + (tipo || 'sem tipo') + ' · ' + (orcamento || 'sem orcamento') + ' · ' + nome,
            Nome: nome,
            Empresa: empresa || '(nao indicada)',
            Email: email,
            Telefone: telefone,
            Pedido: pedido,
            Rota: rotaNome,
            Idioma: idioma === 'en' ? 'Inglês · responder em inglês' : 'Português',
            'Tipo de projeto': tipo || '(nao indicado)',
            'Data prevista': dataProjeto || '(nao indicada)',
            Orcamento: orcamento || '(nao indicado)',
            Mensagem: mensagem || '(sem mensagem)',
            _replyto: email,
          }),
        });
      } catch (_) { /* best-effort: nunca bloqueia o lead */ }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response('error: ' + (e && e.message), { status: 500, headers: CORS });
  }
}
