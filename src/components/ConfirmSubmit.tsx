"use client";
import type { ReactNode } from "react";

/** Botão de envio que pede confirmação antes de disparar a server action do formulário. */
export function ConfirmSubmit({ message, children, className, formAction, disabled }: {
  message: string;
  children: ReactNode;
  className?: string;
  formAction: (formData: FormData) => void | Promise<void>;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={disabled}
      className={className}
      onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}
    >
      {children}
    </button>
  );
}
