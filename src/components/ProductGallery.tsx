"use client";
import { useState } from "react";
import { placeholder } from "@/lib/placeholder";

export default function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const list = images?.length ? images : [placeholder(name)];
  const [i, setI] = useState(0);

  return (
    <div className="gal">
      <div className="main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={list[i] || list[0]} alt={name} width={800} height={800} />
      </div>
      {list.length > 1 && (
        <div className="thumbs">
          {list.map((src, ix) => (
            <button key={ix} type="button" aria-current={ix === i} onClick={() => setI(ix)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
