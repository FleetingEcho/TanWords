import type { Dict } from "../types";
import { common } from "./common";
import { nav } from "./nav";
import { reading } from "./reading";
import { hackernews } from "./hackernews";
import { reader } from "./reader";
import { documents } from "./documents";
import { dashboard } from "./dashboard";
import { discover } from "./discover";
import { vocabulary } from "./vocabulary";
import { search } from "./search";
import { chat } from "./chat";
import { settings } from "./settings";
import { wordModal } from "./wordModal";
import { aichat } from "./aichat";
import { tts } from "./tts";
import { feeds } from "./feeds";
import { podcast } from "./podcast";
import { tools } from "./tools";
import { knowledgeMap } from "./knowledgeMap";

export const zh: Dict = {
    ...common,
    ...nav,
    ...reading,
    ...hackernews,
    ...reader,
    ...documents,
    ...dashboard,
    ...discover,
    ...vocabulary,
    ...search,
    ...chat,
    ...settings,
    ...wordModal,
    ...aichat,
    ...tts,
    ...feeds,
    ...podcast,
    ...tools,
    ...knowledgeMap,
};
