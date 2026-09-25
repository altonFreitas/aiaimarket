import Image from "next/image";

/* THE SHOP'S OWN MARK, AS THE PICTURE.
 *
 * Both reference designs put a photograph in the right-hand third -- a
 * pair of headphones on one, the shop front on the other. This shop has
 * neither, and inventing one means either a stock photo of somewhere
 * that is not Dili or a picture of a product it may not stock.
 *
 * So the decoration is the shop's own logo on a soft field, which is the
 * one image that is always true. The shape behind it is drawn rather than
 * fetched: no request, no layout shift, and it recolours with the theme.
 *
 * aria-hidden, because it says nothing the heading beside it has not
 * already said -- to a screen reader this panel is decoration.
 */
export default function StoreMark({ label }: { label: string }) {
  return (
    <div className="storemark" aria-hidden="true">
      <span className="storemark-blob" />
      <span className="storemark-blob storemark-blob-2" />
      <div className="storemark-in">
        <Image src="/logo-mark.webp" alt="" width={280} height={115}
          style={{ width: "min(190px, 62%)", height: "auto" }} />
        <b>{label}</b>
      </div>
    </div>
  );
}
