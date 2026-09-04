import type { Lang } from "./types";

/* The shop's terms, privacy notice and returns policy.
 *
 * READ THIS BEFORE PUBLISHING THEM.
 *
 * These are DRAFTS. They describe accurately how this shop actually works
 * -- what it collects, how it is paid, how a return is handled -- because a
 * policy copied from another company describes that company and is worse
 * than none. But describing your practice accurately is not the same as
 * being legally sufficient in Timor-Leste, and I am not able to tell you
 * whether it is. Have somebody who can read them before you rely on them.
 *
 * The places only you can fill are marked FILL IN and appear on the page as
 * they are written here, so an unreviewed policy is obvious rather than
 * quietly wrong.
 *
 * Kept out of lib/i18n.ts on purpose. That file is short interface strings
 * where a missing key is a visible glitch; this is prose where a missing
 * paragraph is a legal gap, and mixing them makes both harder to review.
 */

export type LegalSlug = "terms" | "privacy" | "returns";

export interface LegalSection {
  heading: [tet: string, pt: string, en: string];
  body: [tet: string, pt: string, en: string][];
}

export interface LegalDoc {
  slug: LegalSlug;
  title: [string, string, string];
  intro: [string, string, string];
  sections: LegalSection[];
}

/** True while any FILL IN marker remains anywhere. The pages show a notice
 * when so, which is deliberately visible to shoppers too: better that a
 * customer sees an unfinished policy than that the shop believes it has a
 * finished one. */
export function hasPlaceholders(doc: LegalDoc): boolean {
  const all = [
    ...doc.title, ...doc.intro,
    ...doc.sections.flatMap((s) => [...s.heading, ...s.body.flat()]),
  ];
  return all.some((s) => s.includes("FILL IN"));
}

export function pick(three: [string, string, string], lang: Lang): string {
  return lang === "pt" ? three[1] : lang === "en" ? three[2] : three[0];
}

const s = (
  heading: [string, string, string], ...body: [string, string, string][]
): LegalSection => ({ heading, body });

/* ------------------------------------------------------------------ */

const TERMS: LegalDoc = {
  slug: "terms",
  title: ["Termu uzu", "Termos de utilização", "Terms of use"],
  intro: [
    "Termu sira ne'e aplika ba ema hotu ne'ebé uza website ida-ne'e no hola sasan iha ne'e.",
    "Estes termos aplicam-se a quem utiliza este site e faz encomendas nele.",
    "These terms apply to anyone who uses this site and places an order on it.",
  ],
  sections: [
    s(["Sé mak ami", "Quem somos", "Who we are"],
      [
        "Loja ne'e mak {STORE}, hela iha {ADDRESS — FILL IN}, rejistu iha {REGISTRATION — FILL IN}. Kontaktu: {CONTACT}.",
        "Esta loja é {STORE}, com morada em {ADDRESS — FILL IN}, registada sob {REGISTRATION — FILL IN}. Contacto: {CONTACT}.",
        "This shop is {STORE}, at {ADDRESS — FILL IN}, registered as {REGISTRATION — FILL IN}. Contact: {CONTACT}.",
      ]),
    s(["Merkadu ho na'in barak", "Um mercado com vários vendedores", "A marketplace with several sellers"],
      [
        "Sasan balun ami mak fa'an, sasan balun na'in seluk mak fa'an liu husi website ne'e. Pájina produtu hatudu sé mak fa'an. Ba sasan husi na'in seluk, sira mak responsavel ba sasan ne'e, no ami ajuda atu rezolve problema.",
        "Alguns produtos são vendidos por nós, outros por vendedores independentes através deste site. A página do produto indica quem vende. No caso de vendedores independentes, é o vendedor que responde pelo produto, e nós ajudamos a resolver problemas.",
        "Some products are sold by us and others by independent sellers through this site. Each product page says who is selling it. For an independent seller's product, that seller is responsible for it, and we help resolve problems.",
      ]),
    s(["Folin no disponibilidade", "Preços e disponibilidade", "Prices and availability"],
      [
        "Folin iha USD. Ami koko atu hatudu stock loloos, maibé bele mosi sasan ida hotu ona molok ami hetan Ita-nia orden. Se nune'e, ami kontaktu Ita no fó fila osan se Ita selu tiha ona.",
        "Os preços são em USD. Procuramos mostrar o stock corretamente, mas um artigo pode esgotar antes de recebermos a sua encomenda. Nesse caso entramos em contacto e devolvemos o que tiver pago.",
        "Prices are in USD. We try to show stock accurately, but an item can sell out before your order reaches us. If that happens we contact you and refund anything you have paid.",
      ]),
    s(["Selu", "Pagamento", "Payment"],
      [
        "Ami simu osan iha momentu entrega ka foti, transferénsia banku, karteira móvel, no kartaun. Ba kartaun, Ita selu iha pájina seguru husi banku nian — ami nunka simu ka rai numeru kartaun.",
        "Aceitamos dinheiro na entrega ou no levantamento, transferência bancária, carteira móvel e cartão. No caso do cartão, o pagamento é feito na página segura do banco — nunca recebemos nem guardamos o número do cartão.",
        "We accept cash on delivery or pickup, bank transfer, mobile wallet, and card. Card payments are made on the bank's own secure page — we never receive or store your card number.",
      ]),
    s(["Entrega", "Entrega", "Delivery"],
      [
        "Ami entrega iha Dili sentru no Dili liur ho folin ne'ebé hatudu iha checkout. Ba munisípiu seluk, ami fó folin uluk. Tempu entrega mak estimativa, la'ós promesa.",
        "Entregamos no centro de Díli e nos arredores, com o custo indicado no checkout. Para outros municípios, damos um orçamento primeiro. Os prazos são estimativas, não garantias.",
        "We deliver in central Dili and its outskirts at the cost shown at checkout. For other municipalities we quote first. Delivery times are estimates, not guarantees.",
      ]),
    s(["Uza website ne'e", "Utilização do site", "Using this site"],
      [
        "Labele uza website ne'e ba buat ilegál, labele halo orden falsu, no labele koko atu tama iha parte ne'ebé la'ós Ita-nian. Ami bele taka asesu ba ema ne'ebé halo nune'e.",
        "Não utilize este site para fins ilegais, não faça encomendas falsas e não tente aceder a áreas que não lhe pertencem. Podemos bloquear o acesso a quem o faça.",
        "Do not use this site for anything unlawful, do not place false orders, and do not try to access parts of it that are not yours. We may block access to anyone who does.",
      ]),
    s(["Lei ne'ebé aplika", "Lei aplicável", "Governing law"],
      [
        "Termu sira ne'e tuir lei Timor-Leste nian.",
        "Estes termos regem-se pela lei de Timor-Leste.",
        "These terms are governed by the law of Timor-Leste.",
      ]),
  ],
};

const PRIVACY: LegalDoc = {
  slug: "privacy",
  title: ["Privasidade", "Privacidade", "Privacy"],
  intro: [
    "Ne'e esplika dadus saida mak ami rai kona-ba Ita, tanba sá, no oinsá atu husu.",
    "Isto explica que dados guardamos sobre si, porquê, e como pode pedir para os ver ou apagar.",
    "This explains what we keep about you, why, and how to ask to see or delete it.",
  ],
  sections: [
    s(["Saida mak ami rai", "O que guardamos", "What we keep"],
      [
        "Bainhira Ita halo orden: Ita-nia naran, numeru telefone, fatin entrega, no sasan saida mak Ita hola. Se Ita hatudu komprovativu pagamentu, ami rai imajen ne'e. Se Ita kria konta, ami rai email.",
        "Quando faz uma encomenda: o seu nome, número de telefone, morada de entrega e os artigos encomendados. Se enviar comprovativo de pagamento, guardamos essa imagem. Se criar conta, guardamos o email.",
        "When you place an order: your name, phone number, delivery address, and what you ordered. If you upload proof of payment, we keep that image. If you create an account, we keep your email address.",
      ],
      [
        "Ami NUNKA rai numeru kartaun kréditu. Selu ho kartaun akontese iha pájina banku nian.",
        "NUNCA guardamos números de cartão. Os pagamentos com cartão são feitos na página do banco.",
        "We never store card numbers. Card payments happen on the bank's own page.",
      ]),
    s(["Tanba sá", "Porquê", "Why"],
      [
        "Atu prepara no entrega Ita-nia orden, atu kontaktu Ita kona-ba orden ne'e, no atu rai rejistu kontabilidade nian tuir lei.",
        "Para preparar e entregar a sua encomenda, para o contactar sobre ela, e para manter os registos contabilísticos exigidos por lei.",
        "To prepare and deliver your order, to contact you about it, and to keep the accounting records the law requires.",
      ]),
    s(["Ho sé mak ami fahe", "Com quem partilhamos", "Who we share it with"],
      [
        "Ho na'in ne'ebé fa'an sasan ne'ebé Ita hola, atu sira bele prepara. Ho serbisu entrega. Ho banku, ba pagamentu. Ami la fa'an dadus ba ema ida.",
        "Com o vendedor do artigo que comprou, para o poder preparar. Com o serviço de entrega. Com o banco, para o pagamento. Não vendemos dados a ninguém.",
        "With the seller of the item you bought, so they can prepare it. With the delivery service. With the bank, for payment. We do not sell your data to anyone.",
      ]),
    s(["Tempu hira", "Durante quanto tempo", "How long"],
      [
        "Rejistu orden nian ami rai tinan {RETENTION YEARS — FILL IN}, tuir obrigasaun kontabilidade. Depois ami hasai.",
        "Guardamos os registos de encomendas durante {RETENTION YEARS — FILL IN} anos, por obrigação contabilística. Depois são eliminados.",
        "We keep order records for {RETENTION YEARS — FILL IN} years, as accounting rules require. After that they are deleted.",
      ]),
    s(["Ita-nia direitu", "Os seus direitos", "Your rights"],
      [
        "Ita bele husu atu haree dadus ne'ebé ami iha kona-ba Ita, atu hadia se sala, ka atu hasai. Kontaktu {CONTACT}.",
        "Pode pedir para ver os dados que temos sobre si, corrigi-los se estiverem errados, ou apagá-los. Contacte {CONTACT}.",
        "You can ask to see what we hold about you, correct it if it is wrong, or have it deleted. Contact {CONTACT}.",
      ]),
  ],
};

const RETURNS: LegalDoc = {
  slug: "returns",
  title: ["Fila fali no fó fila osan", "Devoluções e reembolsos", "Returns and refunds"],
  intro: [
    "Se sasan la loos, ka aat, ka lae hanesan deskrisaun, ami troka ka fó fila osan.",
    "Se um artigo estiver errado, danificado, ou não corresponder à descrição, trocamos ou devolvemos o dinheiro.",
    "If an item is wrong, damaged, or not as described, we will replace it or refund you.",
  ],
  sections: [
    s(["Tempu hira", "Prazo", "How long you have"],
      [
        "Kontaktu ami iha loron {RETURN DAYS — FILL IN} nia laran hafoin simu sasan.",
        "Contacte-nos no prazo de {RETURN DAYS — FILL IN} dias após receber a encomenda.",
        "Contact us within {RETURN DAYS — FILL IN} days of receiving your order.",
      ]),
    s(["Saida mak bele fila", "O que pode ser devolvido", "What can be returned"],
      [
        "Sasan ne'ebé sei iha kondisaun hanesan bainhira Ita simu, ho ninia enbalajen. Sasan ne'ebé aat ka la loos, ami simu nafatin, maski loke tiha ona.",
        "Artigos na mesma condição em que os recebeu, com a embalagem. Artigos danificados ou errados são aceites mesmo depois de abertos.",
        "Items in the condition you received them, with their packaging. Damaged or incorrect items are accepted even once opened.",
      ],
      [
        "Sasan ne'ebé halo espesialmente ba Ita, no sasan ne'ebé la bele fa'an fali tanba higiene, ami la bele simu — se la'ós aat ka la loos.",
        "Artigos feitos por medida e artigos que não podem ser revendidos por razões de higiene não são aceites — salvo se estiverem danificados ou errados.",
        "Made-to-order items, and items that cannot be resold for hygiene reasons, cannot be returned — unless they are damaged or incorrect.",
      ]),
    s(["Oinsá", "Como fazer", "How to do it"],
      [
        "Kontaktu ami liu husi {CONTACT} ho Ita-nia referénsia orden nian. Ami hatete oinsá fila sasan ne'e.",
        "Contacte-nos por {CONTACT} com a referência da sua encomenda. Explicamos como devolver.",
        "Contact us on {CONTACT} with your order reference. We will explain how to return it.",
      ]),
    s(["Fó fila osan", "Reembolsos", "Refunds"],
      [
        "Ami fó fila osan liu husi dalan hanesan ne'ebé Ita selu, iha loron {REFUND DAYS — FILL IN} nia laran hafoin ami simu sasan. Se sasan aat ka la loos, ami mós selu kustu entrega.",
        "Devolvemos pelo mesmo meio que usou para pagar, no prazo de {REFUND DAYS — FILL IN} dias após recebermos o artigo. Se estiver danificado ou errado, devolvemos também o custo de entrega.",
        "We refund by the same method you paid with, within {REFUND DAYS — FILL IN} days of receiving the item back. If it was damaged or incorrect, we refund the delivery cost too.",
      ]),
  ],
};

export const LEGAL_DOCS: Record<LegalSlug, LegalDoc> = {
  terms: TERMS,
  privacy: PRIVACY,
  returns: RETURNS,
};

/** Substitutes what the shop already knows about itself, so the store name
 * and contact number are never a second place to keep up to date. */
export function fillLegal(
  text: string, vars: { store: string; contact: string }
): string {
  return text
    .replaceAll("{STORE}", vars.store)
    .replaceAll("{CONTACT}", vars.contact || "—");
}
