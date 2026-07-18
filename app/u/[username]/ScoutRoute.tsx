"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ResultView from "@/components/ResultView";
import { readCardCache, writeCardCache } from "@/hooks/useScout";
import { isUsablePhotoAvatar } from "@/lib/media/photoAvatar";
import type { Card } from "@/lib/scoring/types";

// Client wrapper: a server component can't pass callbacks across the boundary,
// so navigation and the report-page flag edit are wired here. Editing the flag
// updates the card in view, reflects the choice in the URL (?country=, removed
// when cleared) so a re-share / reload keeps it, and writes the localStorage
// cache so the home flow sees the same choice within the TTL.
export default function ScoutRoute({
  card: initial,
  canonicalCountry,
}: {
  card: Card;
  canonicalCountry: string;
}) {
  const router = useRouter();
  const [card, setCard] = useState(initial);

  // For every local-* card: keep the same story photo on OPEN CARD / share URL
  // (merge browser cache if the server stripped a data: embed).
  useEffect(() => {
    setCard(initial);
    const login = initial.login.toLowerCase();
    if (!login.startsWith("local-")) {
      writeCardCache(initial);
      return;
    }

    if (isUsablePhotoAvatar(initial.avatarUrl)) {
      writeCardCache(initial);
      return;
    }

    const cached = readCardCache(login);
    if (cached && isUsablePhotoAvatar(cached.avatarUrl)) {
      const next: Card = {
        ...initial,
        avatarUrl: cached.avatarUrl,
        cardImageUrl: null,
      };
      setCard(next);
      writeCardCache(next);
      void fetch("/api/local/persist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card: next,
          hit: {
            title: next.market?.question || next.name,
            url: next.market?.externalUrl || "",
            sourceHost: "local",
            summary: next.market?.description || "",
            imageUrl: next.avatarUrl?.startsWith("http") ? next.avatarUrl : null,
          },
        }),
      }).catch(() => {
        /* best-effort */
      });
      return;
    }

    writeCardCache(initial);
  }, [initial]);

  const onCountryChange = (code: string) => {
    const next = { ...card, country: code };
    setCard(next);
    writeCardCache(next);
    const url = new URL(window.location.href);
    if (code) url.searchParams.set("country", code);
    else url.searchParams.delete("country");
    router.replace(url.pathname + url.search, { scroll: false });
  };

  return (
    <ResultView
      key={`${card.login}-${card.avatarUrl?.slice(0, 48) || "nophoto"}`}
      card={card}
      onBack={() => router.push("/")}
      onCountryChange={onCountryChange}
      canonicalCountry={canonicalCountry}
    />
  );
}
