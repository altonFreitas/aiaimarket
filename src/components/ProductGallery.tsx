"use client";
import { useState } from "react";
import Image from "next/image";
import { placeholder } from "@/lib/placeholder";

export default function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const list = images?.length ? images : [placeholder(name)];
  const [i, setI] = useState(0);

  return (
    <div className="gal">
      <div className="main">
        {/* priority: this is the product page's Largest Contentful Paint
            element, so it must not wait behind lazy-loading heuristics. */}
        <Image
          src={list[i] || list[0]}
          alt={name}
          width={800}
          height={800}
          priority
          sizes="(max-width: 700px) 100vw, 520px"
          unoptimized={(list[i] || list[0]).startsWith("data:")}
        />
      </div>
      {list.length > 1 && (
        <div className="thumbs">
          {list.map((src, ix) => (
            <button key={ix} type="button" aria-current={ix === i} onClick={() => setI(ix)}>
              <Image
                src={src}
                alt=""
                width={96}
                height={96}
                loading="lazy"
                sizes="96px"
                unoptimized={src.startsWith("data:")}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
