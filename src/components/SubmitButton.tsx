"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "./ui";

/** Form gönderilirken anında "…" durumuna geçen ve çift tıklamayı engelleyen düğme */
export function SubmitButton({
  children,
  pendingLabel = "Gönderiliyor…",
  disabled,
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} disabled={pending || disabled}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
