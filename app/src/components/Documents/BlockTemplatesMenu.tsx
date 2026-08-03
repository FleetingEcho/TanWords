import { Beaker, BookOpen, Bug, CheckSquare, NotebookPen, PlaySquare, Quote, LayoutTemplate, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/hooks/useT";

/** One shape for everything you track: what it is, where it is, what happened.
 *
 *  The pipeline is a checklist rather than a table or a heading per stage —
 *  ticking a box is the whole interaction, and the first unticked line answers
 *  "where is this stuck" without reading anything. The log is one list rather
 *  than notes hung under each stage: most stages have nothing to say, and a
 *  single timeline still reads in order months later. */
function tracker(options: {
  heading: string;
  status: string;
  stages: string[];
  /** Sections that only make sense for this kind of work (a prototype has a
   *  question and a verdict; a bug fix does not). */
  lead?: { heading: string; body: string };
  tail?: { heading: string; body: string };
}): any[] {
  const blocks: any[] = [
    { type: "heading", props: { level: 2 }, content: options.heading },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Status: ", styles: { bold: true } },
        { type: "text", text: options.status, styles: {} },
      ],
    },
  ];
  if (options.lead) {
    blocks.push({ type: "heading", props: { level: 3 }, content: options.lead.heading });
    blocks.push({ type: "paragraph", content: options.lead.body });
  }
  blocks.push({ type: "heading", props: { level: 3 }, content: "Pipeline" });
  for (const stage of options.stages) {
    blocks.push({ type: "checkListItem", props: { checked: false }, content: stage });
  }
  blocks.push({ type: "heading", props: { level: 3 }, content: "Log" });
  blocks.push({
    type: "quote",
    content: [
      { type: "text", text: "0000-00-00 · stage", styles: { bold: true } },
      { type: "text", text: " — what happened, what you found", styles: {} },
    ],
  });
  if (options.tail) {
    blocks.push({ type: "heading", props: { level: 3 }, content: options.tail.heading });
    blocks.push({ type: "paragraph", content: options.tail.body });
  }
  return blocks;
}

const trackers = [
  {
    id: "bug",
    icon: Bug,
    titleKey: "doc.templateBug",
    blocks: () => tracker({
      heading: "Fix a bug — #0000",
      status: "not started",
      stages: ["Reproduced", "Fixing", "Fixed", "Self-tested", "MR raised", "In QA", "Merged"],
    }),
  },
  {
    id: "feature",
    icon: Sparkles,
    titleKey: "doc.templateFeature",
    blocks: () => tracker({
      heading: "Feature — name",
      status: "not started",
      // Written before the pipeline on purpose: a feature that cannot state
      // its scope in two lines is not ready to be built.
      lead: { heading: "Scope", body: "What it does, and explicitly what it does not." },
      stages: ["Scoped", "Designed", "Building", "Self-tested", "MR raised", "In QA", "Merged", "Released"],
    }),
  },
  {
    id: "prototype",
    icon: Beaker,
    titleKey: "doc.templatePrototype",
    blocks: () => tracker({
      heading: "Prototype — question",
      status: "exploring",
      // A prototype's output is an answer, not a merge. Hence a question at
      // the top, a verdict at the bottom, and no "Released" stage.
      lead: { heading: "Question", body: "What are you trying to find out? What would settle it either way?" },
      stages: ["Question framed", "Timebox set", "Exploring", "Findings written", "Decision made", "Follow-up filed"],
      tail: { heading: "Verdict", body: "Keep / drop / needs more — and the one reason why." },
    }),
  },
];

const TEMPLATES = [
  {
    id: "youtube",
    icon: PlaySquare,
    titleKey: "doc.templateYouTube",
    // Empty on purpose: the block renders its own URL field, so there is
    // nothing to delete out of a placeholder first.
    blocks: (): any[] => [{ type: "youtube", props: { url: "" } }],
  },
  {
    id: "callout",
    icon: Quote,
    titleKey: "doc.templateCallout",
    blocks: (): any[] => [
      { type: "quote", content: "Callout: write the key idea here" },
      { type: "paragraph", content: "Supporting detail goes below." },
    ],
  },
  {
    id: "todo",
    icon: CheckSquare,
    titleKey: "doc.templateTodo",
    blocks: (): any[] => [
      { type: "checkListItem", props: { checked: false }, content: "First task" },
      { type: "checkListItem", props: { checked: false }, content: "Second task" },
    ],
  },
  {
    id: "definition",
    icon: BookOpen,
    titleKey: "doc.templateDefinition",
    blocks: (): any[] => [
      { type: "heading", props: { level: 2 }, content: "Term" },
      { type: "paragraph", content: "Definition in one or two sentences." },
      { type: "bulletListItem", content: "Example usage" },
    ],
  },
  ...trackers,
  {
    id: "meeting",
    icon: NotebookPen,
    titleKey: "doc.templateMeeting",
    blocks: (): any[] => [
      { type: "heading", props: { level: 2 }, content: "Meeting notes" },
      { type: "paragraph", content: "Context and objective." },
      { type: "bulletListItem", content: "Decision 1" },
      { type: "bulletListItem", content: "Action item: owner, due date" },
    ],
  },
];

export function BlockTemplatesMenu({ editor }: { editor: any }) {
  const t = useT();

  const insertTemplate = (blocks: any[]) => {
    const current = editor.getTextCursorPosition().block;
    editor.insertBlocks(blocks, current, "after");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("doc.templates")}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          {t("doc.templates")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => insertTemplate(template.blocks())}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium hover:bg-muted"
          >
            <template.icon className="h-3.5 w-3.5 text-muted-foreground" />
            {t(template.titleKey)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
