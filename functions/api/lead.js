// Cloudflare Pages Function: recebe os pedidos do site.
// 1) Cria uma ficha no Notion (CRM — Clientes & Prospects).
// 2) (Opcional) Adiciona o contacto ao MailerLite, para o envio automatico do guia e a newsletter semanal.
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

    // Pedido: "Orçamento" | "Guia gratuito" | "Contacto"
    let pedido = s(d.pedido, 40);
    if (!['Orçamento', 'Guia gratuito', 'Contacto'].includes(pedido)) pedido = 'Contacto';
    const isGuia = pedido === 'Guia gratuito';

    const assunto = s(d._subject, 200) || ('Pedido do site · ' + pedido);
    const notas = assunto + (mensagem ? ' — ' + mensagem : '');
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

    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.NOTION_TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: env.NOTION_DB || 'bad23aa9-3823-4814-a6e3-72aa0e59e548' },
        properties: props,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return new Response('Notion error: ' + t, { status: 502, headers: CORS });
    }

    // ---- 2) MailerLite (best-effort: nunca falha o pedido) ----
    if (email && env.MAILERLITE_TOKEN) {
      const groups = [];
      if (isGuia && env.MAILERLITE_GROUP_GUIA) groups.push(env.MAILERLITE_GROUP_GUIA);
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
            fields: { name: nome, phone: telefone },
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
            _subject: 'Novo lead do site · ' + pedido + ' · ' + nome,
            Nome: nome,
            Email: email,
            Telefone: telefone,
            Pedido: pedido,
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
