export type EditorLinkFailureCode =
  | "editor-link-disposed"
  | "editor-link-invalid"
  | "editor-link-open-failed";

export type EditorLinkResult =
  | Readonly<{ status: "requested" }>
  | Readonly<{
      code: EditorLinkFailureCode;
      status: "failed";
    }>;

export type EditorLinkPort = Readonly<{
  dispose: () => void;
  open: (href: string) => EditorLinkResult;
}>;
