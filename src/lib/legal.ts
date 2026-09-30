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

/* TERMS AND PRIVACY ARE ONE DOCUMENT NOW. They were two pages a shopper
   had to find separately, and they overlap so heavily -- who we are, what
   an order commits each side to, what we do with what you typed -- that
   reading one without the other left half a picture. The privacy text has
   not changed a word; it is the second half of the terms page, under its
   own heading, and /legal/privacy still resolves (see LEGAL_MOVED). */
export type LegalSlug = "terms" | "returns";

/** One paragraph in all four languages, in lib/i18n.ts's order: Tetun,
 * Portuguese, English, Indonesian. Named rather than written out at each
 * use, because a legal paragraph that is a language short is a shopper
 * reading their rights in a language they did not ask for. */
export type LegalText = [tet: string, pt: string, en: string, id: string];

export interface LegalSection {
  heading: LegalText;
  body: LegalText[];
  /** An anchor, for a heading something links straight to. Only the
   * privacy half of the terms page has one -- /legal/privacy redirects to
   * it, so every printed receipt and cookie banner that names that URL
   * still lands on the right paragraph rather than the top of a long
   * page. */
  id?: string;
}

export interface LegalDoc {
  slug: LegalSlug;
  title: LegalText;
  intro: LegalText;
  sections: LegalSection[];
}

/** What the shop must tell these documents about itself.
 *
 * THESE ARE NOT TEXT SOMEBODY FORGOT TO WRITE. They are facts about this
 * business -- where it trades from, what it is registered as, and the three
 * periods it chooses to commit to -- and no author could supply them. Filling
 * a plausible number in would have been the one genuinely dangerous option:
 * a returns policy stating a refund window the shop never agreed to is a
 * promise it did not make, published in its name.
 *
 * So they come from settings, the owner states them once, and the pages keep
 * showing their unfinished-policy notice until every one is there. */
export interface LegalVars {
  store: string;
  contact: string;
  address?: string | null;
  registration?: string | null;
  retentionYears?: number | null;
  returnDays?: number | null;
  refundDays?: number | null;
}

/** True while any FILL IN marker survives substitution.
 *
 * CHECKED AFTER FILLING, not before. It used to read the raw document, so it
 * was true forever by construction -- the markers live in the source text and
 * nothing could ever remove them. The notice was therefore permanent and told
 * the shop nothing about whether it had done the work. Now it goes away
 * exactly when the work is done.
 *
 * The notice is shown to shoppers as well as to the owner, on purpose:
 * better that a customer sees an unfinished policy than that the shop
 * believes it has a finished one. */
export function hasPlaceholders(doc: LegalDoc, vars: LegalVars): boolean {
  const all = [
    ...doc.title, ...doc.intro,
    ...doc.sections.flatMap((s) => [...s.heading, ...s.body.flat()]),
  ];
  return all.some((text) => fillLegal(text, vars).includes("FILL IN"));
}

/** The vars, built from a settings row, in ONE place.
 *
 * The page and the launch-readiness panel both ask "is this policy
 * finished". Two call sites assembling this by hand is two chances for the
 * panel to say yes while the page still shows a marker. */
export function legalVars(settings: {
  store_name?: string | null; wa_number?: string | null;
  legal_address?: string | null; legal_registration?: string | null;
  legal_retention_years?: number | null; legal_return_days?: number | null;
  legal_refund_days?: number | null;
} | null | undefined): LegalVars {
  return {
    store: settings?.store_name || "",
    contact: settings?.wa_number || "",
    address: settings?.legal_address,
    registration: settings?.legal_registration,
    retentionYears: settings?.legal_retention_years,
    returnDays: settings?.legal_return_days,
    refundDays: settings?.legal_refund_days,
  };
}

/** Falls back to Tetun, the shop's own language, for anything else --
 * which cannot happen while the tuples are typed, and is what a stray
 * `as` somewhere would otherwise render as `undefined` on a legal page. */
export function pick(four: LegalText, lang: Lang): string {
  return lang === "pt" ? four[1]
    : lang === "en" ? four[2]
    : lang === "id" ? four[3]
    : four[0];
}

const s = (heading: LegalText, ...body: LegalText[]): LegalSection =>
  ({ heading, body });

/* ------------------------------------------------------------------ */

const TERMS: LegalDoc = {
  slug: "terms",
  title: ["Termu uzu", "Termos de utilização", "Terms of use", "Syarat penggunaan"],
  intro: [
    "Termu sira ne'e aplika ba ema hotu ne'ebé uza website ida-ne'e no hola sasan iha ne'e.",
    "Estes termos aplicam-se a quem utiliza este site e faz encomendas nele.",
    "These terms apply to anyone who uses this site and places an order on it.",
    "Syarat ini berlaku bagi siapa pun yang memakai situs ini dan membuat pesanan di sini.",
  ],
  sections: [
    s(["Sé mak ami", "Quem somos", "Who we are", "Siapa kami"],
      [
        "Loja ne'e mak {STORE}, hela iha {ADDRESS — FILL IN}, rejistu iha {REGISTRATION — FILL IN}. Kontaktu: {CONTACT}.",
        "Esta loja é {STORE}, com morada em {ADDRESS — FILL IN}, registada sob {REGISTRATION — FILL IN}. Contacto: {CONTACT}.",
        "This shop is {STORE}, at {ADDRESS — FILL IN}, registered as {REGISTRATION — FILL IN}. Contact: {CONTACT}.",
        "Toko ini adalah {STORE}, beralamat di {ADDRESS — FILL IN}, terdaftar sebagai {REGISTRATION — FILL IN}. Kontak: {CONTACT}.",
      ]),
    s(["Merkadu ho na'in barak", "Um mercado com vários vendedores", "A marketplace with several sellers", "Sebuah marketplace dengan beberapa penjual"],
      [
        "Sasan balun ami mak fa'an, sasan balun na'in seluk mak fa'an liu husi website ne'e. Pájina produtu hatudu sé mak fa'an. Ba sasan husi na'in seluk, sira mak responsavel ba sasan ne'e, no ami ajuda atu rezolve problema.",
        "Alguns produtos são vendidos por nós, outros por vendedores independentes através deste site. A página do produto indica quem vende. No caso de vendedores independentes, é o vendedor que responde pelo produto, e nós ajudamos a resolver problemas.",
        "Some products are sold by us and others by independent sellers through this site. Each product page says who is selling it. For an independent seller's product, that seller is responsible for it, and we help resolve problems.",
        "Sebagian produk dijual oleh kami dan sebagian lagi oleh penjual mandiri melalui situs ini. Setiap halaman produk menyebutkan siapa yang menjualnya. Untuk produk penjual mandiri, penjual itulah yang bertanggung jawab atasnya, dan kami membantu menyelesaikan masalah.",
      ]),
    s(["Folin no disponibilidade", "Preços e disponibilidade", "Prices and availability", "Harga dan ketersediaan"],
      [
        "Folin iha USD. Ami koko atu hatudu stock loloos, maibé bele mosi sasan ida hotu ona molok ami hetan Ita-nia orden. Se nune'e, ami kontaktu Ita no fó fila osan se Ita selu tiha ona.",
        "Os preços são em USD. Procuramos mostrar o stock corretamente, mas um artigo pode esgotar antes de recebermos a sua encomenda. Nesse caso entramos em contacto e devolvemos o que tiver pago.",
        "Prices are in USD. We try to show stock accurately, but an item can sell out before your order reaches us. If that happens we contact you and refund anything you have paid.",
        "Harga dalam USD. Kami berusaha menampilkan stok dengan tepat, tetapi sebuah barang bisa habis sebelum pesanan Anda sampai ke kami. Bila itu terjadi, kami menghubungi Anda dan mengembalikan apa pun yang sudah Anda bayar.",
      ]),
    s(["Selu", "Pagamento", "Payment", "Pembayaran"],
      [
        "Ami simu osan iha momentu entrega ka foti, transferénsia banku, karteira móvel, no kartaun. Ba kartaun, Ita selu iha pájina seguru husi banku nian — ami nunka simu ka rai numeru kartaun.",
        "Aceitamos dinheiro na entrega ou no levantamento, transferência bancária, carteira móvel e cartão. No caso do cartão, o pagamento é feito na página segura do banco — nunca recebemos nem guardamos o número do cartão.",
        "We accept cash on delivery or pickup, bank transfer, mobile wallet, and card. Card payments are made on the bank's own secure page — we never receive or store your card number.",
        "Kami menerima uang tunai saat diantar atau diambil, transfer bank, dompet digital, dan kartu. Pembayaran kartu dilakukan di halaman aman milik bank sendiri — kami tidak pernah menerima atau menyimpan nomor kartu Anda.",
      ]),
    s(["Entrega", "Entrega", "Delivery", "Pengiriman"],
      [
        "Ami entrega iha Dili sentru no Dili liur ho folin ne'ebé hatudu iha checkout. Ba munisípiu seluk, ami fó folin uluk. Tempu entrega mak estimativa, la'ós promesa.",
        "Entregamos no centro de Díli e nos arredores, com o custo indicado no checkout. Para outros municípios, damos um orçamento primeiro. Os prazos são estimativas, não garantias.",
        "We deliver in central Dili and its outskirts at the cost shown at checkout. For other municipalities we quote first. Delivery times are estimates, not guarantees.",
        "Kami mengantar di pusat Dili dan pinggirannya dengan biaya yang ditampilkan saat checkout. Untuk kotamadya lain kami memberi penawaran dulu. Waktu pengiriman adalah perkiraan, bukan jaminan.",
      ]),
    s(["Uza website ne'e", "Utilização do site", "Using this site", "Memakai situs ini"],
      [
        "Labele uza website ne'e ba buat ilegál, labele halo orden falsu, no labele koko atu tama iha parte ne'ebé la'ós Ita-nian. Ami bele taka asesu ba ema ne'ebé halo nune'e.",
        "Não utilize este site para fins ilegais, não faça encomendas falsas e não tente aceder a áreas que não lhe pertencem. Podemos bloquear o acesso a quem o faça.",
        "Do not use this site for anything unlawful, do not place false orders, and do not try to access parts of it that are not yours. We may block access to anyone who does.",
        "Jangan memakai situs ini untuk hal yang melanggar hukum, jangan membuat pesanan palsu, dan jangan mencoba mengakses bagian yang bukan milik Anda. Kami dapat memblokir akses siapa pun yang melakukannya.",
      ]),
    s(["Lei ne'ebé aplika", "Lei aplicável", "Governing law", "Hukum yang berlaku"],
      [
        "Termu sira ne'e tuir lei Timor-Leste nian.",
        "Estes termos regem-se pela lei de Timor-Leste.",
        "These terms are governed by the law of Timor-Leste.",
        "Syarat ini tunduk pada hukum Timor-Leste.",
      ]),
  ],
};

/* NOT A PAGE OF ITS OWN ANY MORE, so it has no slug: this is the second
   half of TERMS_AND_PRIVACY below. The text is untouched -- only where it
   is published changed. */
const PRIVACY: Omit<LegalDoc, "slug"> = {
  title: ["Privasidade", "Privacidade", "Privacy", "Privasi"],
  intro: [
    "Ne'e esplika dadus saida mak ami rai kona-ba Ita, tanba sá, no oinsá atu husu.",
    "Isto explica que dados guardamos sobre si, porquê, e como pode pedir para os ver ou apagar.",
    "This explains what we keep about you, why, and how to ask to see or delete it.",
    "Ini menjelaskan data apa yang kami simpan tentang Anda, mengapa, dan bagaimana cara meminta untuk melihat atau menghapusnya.",
  ],
  sections: [
    s(["Saida mak ami rai", "O que guardamos", "What we keep", "Apa yang kami simpan"],
      [
        "Bainhira Ita halo orden: Ita-nia naran, numeru telefone, fatin entrega, no sasan saida mak Ita hola. Se Ita hatudu komprovativu pagamentu, ami rai imajen ne'e. Se Ita kria konta, ami rai email.",
        "Quando faz uma encomenda: o seu nome, número de telefone, morada de entrega e os artigos encomendados. Se enviar comprovativo de pagamento, guardamos essa imagem. Se criar conta, guardamos o email.",
        "When you place an order: your name, phone number, delivery address, and what you ordered. If you upload proof of payment, we keep that image. If you create an account, we keep your email address.",
        "Saat Anda membuat pesanan: nama, nomor telepon, alamat pengiriman, dan apa yang Anda pesan. Bila Anda mengunggah bukti pembayaran, kami menyimpan gambar itu. Bila Anda membuat akun, kami menyimpan alamat email Anda.",
      ],
      [
        "Ami NUNKA rai numeru kartaun kréditu. Selu ho kartaun akontese iha pájina banku nian.",
        "NUNCA guardamos números de cartão. Os pagamentos com cartão são feitos na página do banco.",
        "We never store card numbers. Card payments happen on the bank's own page.",
        "Kami tidak pernah menyimpan nomor kartu. Pembayaran kartu berlangsung di halaman milik bank sendiri.",
      ]),
    s(["Cookies", "Cookies", "Cookies", "Kuki"],
      [
        "Ami uza cookie ha'at de'it, no hotu-hotu presiza atu loja ne'e serbisu: ida hatene lian ne'ebé Ita hili, no tolu seluk mantein sesaun ba ema ne'ebé tama iha admin ka loja nian. Laiha cookie ba publisidade, laiha ba analytics, no laiha ema seluk nian.",
        "Usamos apenas quatro cookies, e todos são necessários para a loja funcionar: um guarda o idioma que escolheu, e os outros três mantêm a sessão de quem entra na administração ou numa loja. Não há cookies de publicidade, nem de analytics, nem de terceiros.",
        "We use four cookies, and every one of them is needed for the shop to work: one remembers the language you chose, and the other three keep the session of someone signed in to the admin or to a store. There are no advertising cookies, no analytics cookies and no third-party cookies.",
        "Kami memakai empat kuki, dan setiap satunya diperlukan agar toko ini berfungsi: satu mengingat bahasa yang Anda pilih, dan tiga lainnya menjaga sesi orang yang masuk ke admin atau ke sebuah toko. Tidak ada kuki iklan, tidak ada kuki analitik, dan tidak ada kuki pihak ketiga.",
      ],
      [
        "Tanba ida ne'e, ami la husu konsentimentu ba cookie — laiha ida ne'ebé presiza. Ita bele hamoos sira iha Ita nia navegador bainhira karik; se hamoos ida lian nian, loja fila ba Tetun.",
        "Por isso não pedimos consentimento para cookies — nenhum deles o exige. Pode apagá-los no seu navegador quando quiser; se apagar o do idioma, a loja volta ao Tetun.",
        "That is why we do not ask you to consent to cookies -- none of them require it. You can clear them in your browser whenever you like; clearing the language one returns the shop to Tetun.",
        "Itulah sebabnya kami tidak meminta persetujuan kuki -- tidak satu pun memerlukannya. Anda bisa menghapusnya di peramban kapan saja; menghapus kuki bahasa mengembalikan toko ke Tetun.",
      ]),
    s(["Tanba sá", "Porquê", "Why", "Mengapa"],
      [
        "Atu prepara no entrega Ita-nia orden, atu kontaktu Ita kona-ba orden ne'e, no atu rai rejistu kontabilidade nian tuir lei.",
        "Para preparar e entregar a sua encomenda, para o contactar sobre ela, e para manter os registos contabilísticos exigidos por lei.",
        "To prepare and deliver your order, to contact you about it, and to keep the accounting records the law requires.",
        "Untuk menyiapkan dan mengantar pesanan Anda, untuk menghubungi Anda mengenai pesanan itu, dan untuk menyimpan catatan akuntansi yang diwajibkan hukum.",
      ]),
    s(["Ho sé mak ami fahe", "Com quem partilhamos", "Who we share it with", "Dengan siapa kami membagikannya"],
      [
        "Ho na'in ne'ebé fa'an sasan ne'ebé Ita hola, atu sira bele prepara. Ho serbisu entrega. Ho banku, ba pagamentu. Ami la fa'an dadus ba ema ida.",
        "Com o vendedor do artigo que comprou, para o poder preparar. Com o serviço de entrega. Com o banco, para o pagamento. Não vendemos dados a ninguém.",
        "With the seller of the item you bought, so they can prepare it. With the delivery service. With the bank, for payment. We do not sell your data to anyone.",
        "Dengan penjual barang yang Anda beli, supaya mereka bisa menyiapkannya. Dengan jasa pengiriman. Dengan bank, untuk pembayaran. Kami tidak menjual data Anda kepada siapa pun.",
      ]),
    s(["Tempu hira", "Durante quanto tempo", "How long", "Berapa lama"],
      [
        "Rejistu orden nian ami rai tinan {RETENTION YEARS — FILL IN}, tuir obrigasaun kontabilidade. Depois ami hasai.",
        "Guardamos os registos de encomendas durante {RETENTION YEARS — FILL IN} anos, por obrigação contabilística. Depois são eliminados.",
        "We keep order records for {RETENTION YEARS — FILL IN} years, as accounting rules require. After that they are deleted.",
        "Kami menyimpan catatan pesanan selama {RETENTION YEARS — FILL IN} tahun, sebagaimana diwajibkan aturan akuntansi. Setelah itu catatan dihapus.",
      ]),
    s(["Ita-nia direitu", "Os seus direitos", "Your rights", "Hak Anda"],
      [
        "Ita bele husu atu haree dadus ne'ebé ami iha kona-ba Ita, atu hadia se sala, ka atu hasai. Kontaktu {CONTACT}.",
        "Pode pedir para ver os dados que temos sobre si, corrigi-los se estiverem errados, ou apagá-los. Contacte {CONTACT}.",
        "You can ask to see what we hold about you, correct it if it is wrong, or have it deleted. Contact {CONTACT}.",
        "Anda bisa meminta untuk melihat data yang kami simpan tentang Anda, membetulkannya bila keliru, atau meminta agar dihapus. Hubungi {CONTACT}.",
      ]),
  ],
};

const RETURNS: LegalDoc = {
  slug: "returns",
  title: ["Fila fali no fó fila osan", "Devoluções e reembolsos", "Returns and refunds", "Pengembalian barang dan dana"],
  intro: [
    "Se sasan la loos, ka aat, ka lae hanesan deskrisaun, ami troka ka fó fila osan.",
    "Se um artigo estiver errado, danificado, ou não corresponder à descrição, trocamos ou devolvemos o dinheiro.",
    "If an item is wrong, damaged, or not as described, we will replace it or refund you.",
    "Bila sebuah barang salah, rusak, atau tidak sesuai deskripsi, kami akan menggantinya atau mengembalikan uang Anda.",
  ],
  sections: [
    s(["Tempu hira", "Prazo", "How long you have", "Berapa lama waktu Anda"],
      [
        "Kontaktu ami iha loron {RETURN DAYS — FILL IN} nia laran hafoin simu sasan.",
        "Contacte-nos no prazo de {RETURN DAYS — FILL IN} dias após receber a encomenda.",
        "Contact us within {RETURN DAYS — FILL IN} days of receiving your order.",
        "Hubungi kami dalam {RETURN DAYS — FILL IN} hari setelah menerima pesanan Anda.",
      ]),
    s(["Saida mak bele fila", "O que pode ser devolvido", "What can be returned", "Apa yang bisa dikembalikan"],
      [
        "Sasan ne'ebé sei iha kondisaun hanesan bainhira Ita simu, ho ninia enbalajen. Sasan ne'ebé aat ka la loos, ami simu nafatin, maski loke tiha ona.",
        "Artigos na mesma condição em que os recebeu, com a embalagem. Artigos danificados ou errados são aceites mesmo depois de abertos.",
        "Items in the condition you received them, with their packaging. Damaged or incorrect items are accepted even once opened.",
        "Barang dalam kondisi seperti saat Anda menerimanya, beserta kemasannya. Barang yang rusak atau salah tetap kami terima meski sudah dibuka.",
      ],
      [
        "Sasan ne'ebé halo espesialmente ba Ita, no sasan ne'ebé la bele fa'an fali tanba higiene, ami la bele simu — se la'ós aat ka la loos.",
        "Artigos feitos por medida e artigos que não podem ser revendidos por razões de higiene não são aceites — salvo se estiverem danificados ou errados.",
        "Made-to-order items, and items that cannot be resold for hygiene reasons, cannot be returned — unless they are damaged or incorrect.",
        "Barang yang dibuat khusus sesuai pesanan, dan barang yang tidak bisa dijual kembali karena alasan higiene, tidak bisa dikembalikan — kecuali bila rusak atau salah.",
      ]),
    s(["Oinsá", "Como fazer", "How to do it", "Bagaimana caranya"],
      [
        "Kontaktu ami liu husi {CONTACT} ho Ita-nia referénsia orden nian. Ami hatete oinsá fila sasan ne'e.",
        "Contacte-nos por {CONTACT} com a referência da sua encomenda. Explicamos como devolver.",
        "Contact us on {CONTACT} with your order reference. We will explain how to return it.",
        "Hubungi kami di {CONTACT} dengan nomor referensi pesanan Anda. Kami akan menjelaskan cara mengembalikannya.",
      ]),
    s(["Fó fila osan", "Reembolsos", "Refunds", "Pengembalian dana"],
      [
        "Ami fó fila osan liu husi dalan hanesan ne'ebé Ita selu, iha loron {REFUND DAYS — FILL IN} nia laran hafoin ami simu sasan. Se sasan aat ka la loos, ami mós selu kustu entrega.",
        "Devolvemos pelo mesmo meio que usou para pagar, no prazo de {REFUND DAYS — FILL IN} dias após recebermos o artigo. Se estiver danificado ou errado, devolvemos também o custo de entrega.",
        "We refund by the same method you paid with, within {REFUND DAYS — FILL IN} days of receiving the item back. If it was damaged or incorrect, we refund the delivery cost too.",
        "Kami mengembalikan uang lewat cara yang sama dengan yang Anda pakai untuk membayar, dalam {REFUND DAYS — FILL IN} hari setelah kami menerima barangnya kembali. Bila barangnya rusak atau salah, kami mengembalikan ongkos kirimnya juga.",
      ]),
  ],
};

/** Terms and privacy, joined -- the terms first, then the privacy text
 * whole and unedited under its own heading.
 *
 * Built by concatenation rather than by retyping: TERMS and PRIVACY above
 * stay the single source of each half, so a correction to a privacy
 * paragraph is still made in one place and cannot drift from a copy. The
 * divider carries the privacy document's own title and intro, which is
 * what makes the seam read as a chapter rather than as a paragraph that
 * changed subject. */
const TERMS_AND_PRIVACY: LegalDoc = {
  slug: "terms",
  title: [
    "Termu uzu no privasidade",
    "Termos de utilização e privacidade",
    "Terms of use and privacy",
    "Syarat penggunaan dan privasi",
  ],
  intro: [
    "Termu sira ne'e aplika ba ema hotu ne'ebé uza website ida-ne'e no hola sasan iha ne'e. Parte segundu esplika dadus saida mak ami rai kona-ba Ita.",
    "Estes termos aplicam-se a quem utiliza este site e faz encomendas nele. A segunda parte explica que dados guardamos sobre si.",
    "These terms apply to anyone who uses this site and places an order on it. The second half explains what we keep about you.",
    "Syarat ini berlaku bagi siapa pun yang memakai situs ini dan membuat pesanan di sini. Bagian kedua menjelaskan data apa yang kami simpan tentang Anda.",
  ],
  sections: [
    ...TERMS.sections,
    // The seam. Its heading is the privacy document's own title, and its
    // body is that document's intro, so nothing was written for the merge
    // that was not already being shown to a shopper.
    { heading: PRIVACY.title, body: [PRIVACY.intro], id: "privacy" },
    ...PRIVACY.sections,
  ],
};

export const LEGAL_DOCS: Record<LegalSlug, LegalDoc> = {
  terms: TERMS_AND_PRIVACY,
  returns: RETURNS,
};

/** Policy URLs that used to be a page of their own and are now part of
 * one. They redirect rather than 404: /legal/privacy is linked from the
 * cookie banner, is the address a shopper is given when they ask what is
 * held about them, and is the page a payment provider looks for when
 * approving a merchant. Losing it would break all three to save a route. */
export const LEGAL_MOVED: Record<string, string> = {
  privacy: "/legal/terms#privacy",
};

/** Substitutes what the shop already knows about itself, so the store name
 * and contact number are never a second place to keep up to date. */
/** Substitutes what the shop has said about itself, and leaves the rest
 * standing.
 *
 * A marker whose setting is still blank is left EXACTLY as written, so it
 * appears on the page and hasPlaceholders() above can see it. Replacing it
 * with an empty string or a dash would produce a sentence that reads as
 * finished -- "We keep order records for  years" -- which is the failure
 * these markers exist to prevent. */
export function fillLegal(text: string, vars: LegalVars): string {
  const keep = (marker: string, value: string | number | null | undefined) =>
    value == null || String(value).trim() === "" ? marker : String(value).trim();

  return text
    .replaceAll("{STORE}", vars.store)
    .replaceAll("{CONTACT}", vars.contact || "—")
    .replaceAll("{ADDRESS — FILL IN}", keep("{ADDRESS — FILL IN}", vars.address))
    .replaceAll("{REGISTRATION — FILL IN}",
      keep("{REGISTRATION — FILL IN}", vars.registration))
    .replaceAll("{RETENTION YEARS — FILL IN}",
      keep("{RETENTION YEARS — FILL IN}", vars.retentionYears))
    .replaceAll("{RETURN DAYS — FILL IN}",
      keep("{RETURN DAYS — FILL IN}", vars.returnDays))
    .replaceAll("{REFUND DAYS — FILL IN}",
      keep("{REFUND DAYS — FILL IN}", vars.refundDays));
}
