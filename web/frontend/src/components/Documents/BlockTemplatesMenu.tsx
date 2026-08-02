import { BookOpen, CheckSquare, NotebookPen, Quote, LayoutTemplate } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/hooks/useT";

const TEMPLATES = [
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
