export type LocalNewsSourceKind = "news" | "reddit" | "twitter";

export type LocalNewsSource = {
  kind: LocalNewsSourceKind;
  title: string;
  url: string;
  snippet?: string;
};

export type LocalNewsHit = {
  title: string;
  url: string;
  summary: string;
  imageUrl: string | null;
  sourceHost: string | null;
  /** Extra corroborating posts from Reddit / X / other news tabs. */
  sources?: LocalNewsSource[];
};
