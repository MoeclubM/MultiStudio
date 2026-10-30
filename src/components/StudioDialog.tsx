import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export function StudioDialog({ open, onOpenChange, title, description, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode;
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="studio-dialog-overlay" />
    <Dialog.Content className="studio-dialog" {...(!description ? { 'aria-describedby': undefined } : {})}>
      <Dialog.Title>{title}</Dialog.Title>
      {description && <Dialog.Description>{description}</Dialog.Description>}
      <Dialog.Close className="studio-dialog-close" aria-label="关闭对话框"><X size={18} /></Dialog.Close>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
