import type { ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dialog, drawerLeft, drawerRight, overlay } from '@/lib/motion';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  hideTitle?: boolean;
}

/** Radix Dialog (focus trap, aria, Esc) + Motion enter/exit via forceMount & AnimatePresence. */
export function Modal({ open, onOpenChange, title, description, children, className, hideTitle }: BaseProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div variants={overlay} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-50 bg-black/60" />
            </Dialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-3 sm:p-6">
              <Dialog.Content asChild forceMount>
                <motion.div
                  variants={dialog} initial="hidden" animate="show" exit="exit"
                  className={cn('pointer-events-auto flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border-strong bg-popover shadow-pop outline-none', className)}
                >
                  <div className={cn('flex items-start justify-between gap-4 border-b border-border px-5 py-4', hideTitle && 'sr-only')}>
                    <div>
                      <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
                      {description ? <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
                    </div>
                    <Dialog.Close className="-mr-1 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
                      <X className="size-4" />
                    </Dialog.Close>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

export function Drawer({ open, onOpenChange, title, description, children, className, side = 'right', hideTitle }: BaseProps & { side?: 'left' | 'right' }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div variants={overlay} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-50 bg-black/60" />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                variants={side === 'right' ? drawerRight : drawerLeft} initial="hidden" animate="show" exit="exit"
                drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: side === 'left' ? 0.4 : 0, right: side === 'right' ? 0.4 : 0 }}
                onDragEnd={(_, info) => { if ((side === 'right' && info.offset.x > 90) || (side === 'left' && info.offset.x < -90)) onOpenChange(false); }}
                className={cn('fixed inset-y-0 z-50 flex w-[min(92vw,440px)] flex-col border-border-strong bg-popover shadow-pop outline-none', side === 'right' ? 'right-0 border-l' : 'left-0 border-r', className)}
              >
                <div className={cn('flex items-start justify-between gap-4 border-b border-border px-4 py-3.5', hideTitle && 'sr-only')}>
                  <div>
                    <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
                    {description ? <Dialog.Description className="text-sm text-muted-foreground">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
                  </div>
                  <Dialog.Close className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close"><X className="size-4" /></Dialog.Close>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
