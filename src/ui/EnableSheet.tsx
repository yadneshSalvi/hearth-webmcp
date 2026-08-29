"use client";
/**
 * How to give an agent access to this page. Shown from the status chip when
 * `document.modelContext` is missing, and linked from the onboarding card.
 */
import { hearthStore, useHearthStore } from "../state/store";
import { useCopyFlash } from "./clipboard";
import { IconCopy } from "./icons";
import { Button, Kbd } from "./primitives";
import { Sheet } from "./Sheet";

const CHROME_FLAG = "chrome://flags/#enable-webmcp-testing";

interface Step {
  title: string;
  body: React.ReactNode;
}

function StepRow({ index, step }: { index: number; step: Step }) {
  return (
    <li className="flex gap-3 border-b border-hairline/70 py-3.5 last:border-0">
      <span className="numerals mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-pill border border-hairline bg-plaster/70 text-[13px] text-ink-muted">
        {index}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-[13px] font-medium text-ink">{step.title}</p>
        <div className="text-[12.5px] leading-relaxed text-ink-muted">{step.body}</div>
      </div>
    </li>
  );
}

export function EnableSheet() {
  const open = useHearthStore((state) => state.ui.enableSheetOpen ?? false);
  const { copied, copy } = useCopyFlash();
  const close = (): void => hearthStore.getState().setUi({ enableSheetOpen: false });

  const steps: Step[] = [
    {
      title: "ChatGPT desktop",
      body: (
        <>
          Open Hearth in ChatGPT&rsquo;s built-in browser (<Kbd>⌘</Kbd> <Kbd>⇧</Kbd> <Kbd>B</Kbd>) and turn
          <span className="text-ink"> Site tools </span> on. The 26 tools appear in the conversation.
        </>
      ),
    },
    {
      title: "Chrome, behind a flag",
      body: (
        <>
          Enable <code className="font-mono text-[11.5px] text-ink">{CHROME_FLAG}</code>, restart Chrome and reload
          this page.
        </>
      ),
    },
    {
      title: "Production origin trial",
      body: <>On hearth.yadneshsalvi.com the WebMCP origin trial is served with the page, so nothing needs enabling.</>,
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Let your agent see this room"
      subtitle="Hearth registers its tools on document.modelContext. Any of these three routes connects an agent."
      width={520}
      footer={
        <>
          <Button variant="secondary" icon={IconCopy} onClick={() => copy(CHROME_FLAG)}>
            {copied ? "Copied the flag URL" : "Copy the Chrome flag"}
          </Button>
          <Button variant="primary" data-autofocus="" onClick={close}>
            Got it
          </Button>
        </>
      }
    >
      <ul className="flex flex-col">
        {steps.map((step, index) => (
          <StepRow key={step.title} index={index + 1} step={step} />
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
        Without an agent you can still drive everything by hand — and the Tools panel shows exactly what an agent
        would find registered here.
      </p>
    </Sheet>
  );
}
