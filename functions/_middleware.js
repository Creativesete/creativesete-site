// Encaminhamento dos subdomínios.
// proposals.creativesete.com/<abreviação+código>/  → pasta /proposals/<pasta>/
// servicos.creativesete.com/[podcast|cursos]/      → páginas com preços (privadas)
// creativesete.com/servicos/[podcast|cursos|eventos]/ → apresentações públicas, sem preços (ficheiros estáticos)
// creativesete.com/proposals/<pasta>/              → redireciona para o endereço novo
//
// Para uma proposta nova: criar a pasta em /proposals/<pasta>/ e juntar aqui uma linha
// em PROPOSTAS com o link "abreviação + 5 caracteres" (ex.: pharmc93b9k).

const PROPOSTAS = {
  miriam1y68y: 'aa37c',          // Miriam Monteiro · concierge
  vicerfdxt4: '092ca',           // Viceroy at Ombria · jantar World Made by Many
  ombriahy1ew: 'viceroy-ombria', // Viceroy at Ombria · parceria anual
  selfcupt6f: '1c704',           // SelfCare Market & Summit
  pharmc93b9k: 'pharmcare',      // Instituto Pharmcare
  expongtn30: 'exponor',         // Exponor
  pcdigagf64p: 'e3f53',          // PCDIGA
  franc60bd9: 'franciscowebsite',// Francisco Lima Marques
  davidcxzz1: 'davidwebsite',    // David Caleja
  pedro5xmkk: 'pedrowebsite',    // Pedro Fernandes
};

const SERVICOS = {
  podcast: 'ddefb',
  cursos: '199a6',
};
const SERVICOS_RAIZ = 'd5ebf'; // a apresentação geral, agora em creativesete.com/servicos/

const PRINCIPAL = 'https://creativesete.com';
const SUB_PROPOSTAS = 'https://proposals.creativesete.com';
const SUB_SERVICOS = 'https://servicos.creativesete.com';

// pasta → endereço novo, para redirecionar os links antigos
const ANTIGOS = {};
for (const [slug, pasta] of Object.entries(PROPOSTAS)) ANTIGOS[pasta] = `${SUB_PROPOSTAS}/${slug}/`;
for (const [slug, pasta] of Object.entries(SERVICOS)) ANTIGOS[pasta] = `${SUB_SERVICOS}/${slug}/`;
ANTIGOS[SERVICOS_RAIZ] = `${PRINCIPAL}/servicos/`;

// Ficheiros partilhados (imagens, vídeos, logótipos). Páginas HTML de /proposals/ não passam,
// para não se abrir uma proposta pelo nome da pasta noutro subdomínio.
const partilhado = p => p.startsWith('/assets/') || p.startsWith('/api/') || p === '/favicon.ico' || p === '/apple-touch-icon.png' ||
  (p.startsWith('/proposals/') && /\.[a-z0-9]{2,5}$/i.test(p) && !p.endsWith('.html'));

const ROBOTS_PROPOSTAS = 'User-agent: *\nDisallow: /\n';
const texto = (corpo, tipo) => new Response(corpo, { headers: { 'content-type': tipo + '; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
async function semIndexar(resposta) {
  const r = new Response(resposta.body, resposta);
  r.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return r;
}

function servir(ctx, url, caminho) {
  const destino = new URL(caminho + url.search, url.origin);
  return ctx.env.ASSETS.fetch(new Request(destino.toString(), ctx.request));
}

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  const host = url.hostname;
  const p = url.pathname;

  // proposals.creativesete.com
  if (host.startsWith('proposals.')) {
    if (p === '/robots.txt') return texto(ROBOTS_PROPOSTAS, 'text/plain');
    return semIndexar(await propostas(ctx, url, p));
  }

  // servicos.creativesete.com: só as páginas com preços (podcast, cursos), enviadas por link e sem indexação.
  // A apresentação pública vive em creativesete.com/servicos/.
  if (host.startsWith('servicos.')) {
    if (p === '/robots.txt') return texto(ROBOTS_PROPOSTAS, 'text/plain');
    if (partilhado(p)) return ctx.next();
    const [, primeiro, ...resto] = p.split('/');
    const pasta = SERVICOS[primeiro];
    if (pasta) {
      if (!resto.length) return Response.redirect(`${url.origin}/${primeiro}/${url.search}`, 301);
      return semIndexar(await servir(ctx, url, `/proposals/${pasta}/${resto.join('/')}`));
    }
    return Response.redirect(`${PRINCIPAL}/servicos/`, 301);
  }

  // creativesete.com/proposals/<pasta>/ → endereço novo (só a página, não os ficheiros)
  const antigo = p.match(/^\/proposals\/([^/]+)\/?(index\.html)?$/);
  if (antigo && ANTIGOS[antigo[1]]) return Response.redirect(ANTIGOS[antigo[1]] + url.search, 301);

  return ctx.next();
}

async function propostas(ctx, url, p) {
  if (partilhado(p)) return ctx.next();
  const [, slug, ...resto] = p.split('/');
  const pasta = PROPOSTAS[slug];
  if (!pasta) return Response.redirect(PRINCIPAL + '/', 302);
  if (!resto.length) return Response.redirect(`${url.origin}/${slug}/${url.search}`, 301);
  return servir(ctx, url, `/proposals/${pasta}/${resto.join('/')}`);
}
