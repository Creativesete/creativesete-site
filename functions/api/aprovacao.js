// Cloudflare Pages Function: recebe a decisão do cliente nas páginas de aprovação
// (proposals.creativesete.com/<código>/) e regista-a no CRM (crm.creativesete.com).
//
// O que faz no CRM:
//   1) muda a edição para "Aprovado" ou "Correções" (as observações ficam nas notas de revisão);
//   2) acrescenta uma linha à cronologia da ficha do cliente.
//
// Variáveis de ambiente (secrets do projeto Pages):
//   CRM_ACCESS_ID, CRM_ACCESS_SECRET  service token do Cloudflare Access com acesso à API do CRM
// Sem elas, a página continua a funcionar (WhatsApp e email) e esta função só responde crm:false.
//
// A ligação entre a página e a edição vive aqui, no servidor, e nunca vem do browser.

const CRM = 'https://crm.creativesete.com';

const ENTREGAS = {
  dicas01q8zr: {
    peca: 'Dicas da Farmacêutica · vídeo 01 (16:9 e 9:16)',
    editId: '3faea02b83a981fe9dabec4e7e50a670',
    contactId: '3ebea02b83a981878733cb85e54707f6',
  },
};

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });

async function crm(env, method, path, body) {
  const r = await fetch(CRM + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'CF-Access-Client-Id': env.CRM_ACCESS_ID,
      'CF-Access-Client-Secret': env.CRM_ACCESS_SECRET,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`CRM ${r.status}`);
  return r.json().catch(() => ({}));
}

export async function onRequestPost({ request, env }) {
  const origem = request.headers.get('origin') || '';
  if (origem && !/^https:\/\/(proposals\.)?creativesete\.com$/.test(origem)) return json({ ok: false }, 403);

  let d;
  try { d = await request.json(); } catch { return json({ ok: false, erro: 'pedido inválido' }, 400); }
  const e = ENTREGAS[String(d.codigo || '')];
  if (!e) return json({ ok: false, erro: 'entrega desconhecida' }, 404);
  const decisao = d.decisao === 'aprovado' ? 'aprovado' : d.decisao === 'alteracoes' ? 'alteracoes' : null;
  if (!decisao) return json({ ok: false, erro: 'decisão em falta' }, 400);
  const texto = String(d.texto || '').trim().slice(0, 4000);
  const nome = String(d.nome || '').trim().slice(0, 120);
  const canal = d.canal === 'whatsapp' ? 'WhatsApp' : 'email';
  if (decisao === 'alteracoes' && !texto) return json({ ok: false, erro: 'observações em falta' }, 400);

  if (!env.CRM_ACCESS_ID || !env.CRM_ACCESS_SECRET) return json({ ok: true, crm: false });

  const quem = nome ? ` (${nome})` : '';
  try {
    if (decisao === 'aprovado') {
      await crm(env, 'POST', '/api/actions/edicao-estado', { editId: e.editId, estado: 'Aprovado' });
      await crm(env, 'POST', `/api/contacts/${e.contactId}/activities`, {
        date: hoje(), kind: 'aprovacao',
        text: `${e.peca}: aprovado sem alterações na página de aprovação${quem}, também enviado por ${canal}.`,
      });
    } else {
      const notas = `${hoje()} · pedido do cliente${quem}:\n${texto}`;
      await crm(env, 'POST', '/api/actions/edicao-estado', { editId: e.editId, estado: 'Correções', notas });
      await crm(env, 'POST', `/api/contacts/${e.contactId}/activities`, {
        date: hoje(), kind: 'aprovacao',
        text: `${e.peca}: pedido de alterações na página de aprovação${quem}, também enviado por ${canal}. ${texto.replace(/\s+/g, ' ').slice(0, 400)}`,
      });
    }
    return json({ ok: true, crm: true });
  } catch (err) {
    return json({ ok: true, crm: false, erro: String(err.message || err) });
  }
}
