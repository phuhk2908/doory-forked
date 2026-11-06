import {
  ArrowLeft,
  ArrowRight,
  LayoutTemplate,
  LayoutGrid,
  PenLine,
  Ruler,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { createUrl, presetParts } from "@/features/presets";
import { PresetShape } from "@/lib/sizePresets/PresetShape";
import {
  quickPresets,
  type SizePreset,
  useSizePresets,
} from "@/lib/sizePresets";
import { noteUsedSize } from "@/lib/sizePresets/choices";
import { Button, Dialog, type ButtonSize, type ButtonVariant } from "@/ui";
import { LazyCreateDesignDialog } from "./LazyCreateDesignDialog";
import styles from "./StartDesigningDialog.module.css";

interface StartOption {
  title: string;
  description: string;
  icon: LucideIcon;
  kind: "design" | "whiteboard";
}

const OPTIONS: StartOption[] = [
  {
    title: "Start a design",
    description:
      "Make a post, slide, poster or logo with templates and ready-made sizes.",
    icon: PenLine,
    kind: "design",
  },
  {
    title: "Start a whiteboard",
    description:
      "Sketch ideas on an infinite canvas and invite people to collaborate live.",
    icon: UsersRound,
    kind: "whiteboard",
  },
];

export interface StartDesigningTriggerProps {
  children: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
  rightIcon?: ReactNode;
}

/** Opens the two starting points without changing the existing guest or account routes. */
export function StartDesigningTrigger({
  children,
  size = "md",
  variant = "primary",
  className,
  rightIcon,
}: StartDesigningTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        rightIcon={rightIcon}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <StartDesigningDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export interface StartDesigningDialogProps {
  open: boolean;
  onClose(): void;
}

export function StartDesigningDialog({
  open,
  onClose,
}: StartDesigningDialogProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<"chooser" | "quick">("chooser");
  const [createOpen, setCreateOpen] = useState(false);
  const [createTab, setCreateTab] = useState<"sizes" | "custom">("sizes");

  function close(): void {
    setStep("chooser");
    onClose();
  }

  function choose(kind: StartOption["kind"]): void {
    if (kind === "design") {
      setStep("quick");
      return;
    }
    close();
    navigate("/drawings/new");
  }

  function choosePreset(preset: SizePreset): void {
    noteUsedSize(preset.id);
    close();
    navigate(createUrl({ presetId: preset.id }));
  }

  function openCreate(tab: "sizes" | "custom"): void {
    setCreateTab(tab);
    close();
    setCreateOpen(true);
  }

  function openTemplates(): void {
    close();
    navigate("/templates");
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={close}
        title={
          step === "chooser"
            ? "What would you like to create?"
            : "Start a design"
        }
        description={
          step === "chooser"
            ? "Choose the canvas that fits what you want to make."
            : "Pick a popular size or explore every option."
        }
        size="lg"
        footer={
          step === "chooser" ? (
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                leftIcon={<ArrowLeft size={16} aria-hidden="true" />}
                onClick={() => setStep("chooser")}
              >
                Back
              </Button>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
            </>
          )
        }
      >
        {step === "chooser" ? (
          <div className={styles.options}>
            {OPTIONS.map(({ title, description, icon: Icon, kind }) => (
              <button
                key={kind}
                type="button"
                className={styles.option}
                onClick={() => choose(kind)}
              >
                <span className={styles.icon} aria-hidden="true">
                  <Icon size={21} />
                </span>
                <span className={styles.copy}>
                  <strong>{title}</strong>
                  <span>{description}</span>
                </span>
                <ArrowRight
                  className={styles.arrow}
                  size={18}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        ) : (
          <QuickStart
            onChoosePreset={choosePreset}
            onOpenCreate={openCreate}
            onOpenTemplates={openTemplates}
          />
        )}
      </Dialog>
      <LazyCreateDesignDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initialTab={createTab}
      />
    </>
  );
}

interface QuickStartProps {
  onChoosePreset(preset: SizePreset): void;
  onOpenCreate(tab: "sizes" | "custom"): void;
  onOpenTemplates(): void;
}

function QuickStart({
  onChoosePreset,
  onOpenCreate,
  onOpenTemplates,
}: QuickStartProps) {
  const catalogue = useSizePresets();
  const presets = quickPresets(catalogue);
  return (
    <div className={styles.quickStart}>
      <div className={styles.quickPresets} aria-label="Popular sizes">
        {presets.map((preset) => {
          const { name, detail } = presetParts(preset);
          return (
            <button
              key={preset.id}
              type="button"
              className={styles.quickPreset}
              onClick={() => onChoosePreset(preset)}
            >
              <span className={styles.quickShape}>
                <PresetShape preset={preset} size={42} />
              </span>
              <span className={styles.quickCopy}>
                <strong>{name}</strong>
                <span>{detail}</span>
              </span>
              <ArrowRight
                className={styles.quickArrow}
                size={15}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      <div className={styles.quickActions} aria-label="More ways to start">
        <button
          type="button"
          className={styles.quickAction}
          onClick={() => onOpenCreate("custom")}
        >
          <Ruler size={18} aria-hidden="true" />
          <span>
            <strong>Custom size</strong>
            <small>Set your own dimensions</small>
          </span>
        </button>
        <button
          type="button"
          className={styles.quickAction}
          onClick={onOpenTemplates}
        >
          <LayoutTemplate size={18} aria-hidden="true" />
          <span>
            <strong>Start from a template</strong>
            <small>Browse ready-made designs</small>
          </span>
        </button>
        <button
          type="button"
          className={styles.quickAction}
          onClick={() => onOpenCreate("sizes")}
        >
          <LayoutGrid size={18} aria-hidden="true" />
          <span>
            <strong>All sizes</strong>
            <small>Open the full size picker</small>
          </span>
        </button>
      </div>
    </div>
  );
}
