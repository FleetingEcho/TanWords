import type { Dict } from "../types";
import { common } from "./common";
import { nav } from "./nav";
import { reading } from "./reading";
import { hackernews } from "./hackernews";
import { reader } from "./reader";
import { documents } from "./documents";
import { dashboard } from "./dashboard";
import { calendar } from "./calendar";
import { discover } from "./discover";
import { vocabulary } from "./vocabulary";
import { search } from "./search";
import { chat } from "./chat";
import { settings } from "./settings";
import { wordModal } from "./wordModal";
import { aichat } from "./aichat";
import { tts } from "./tts";
import { voice } from "./voice";
import { feeds } from "./feeds";
import { podcast } from "./podcast";
import { tools } from "./tools";
import { toolsPage } from "./toolsPage";
import { music } from "./music";
import { browser } from "./browser";
import { floatingBrowser } from "./floatingBrowser";
import { dsh } from "./dsh";
import { updater } from "./updater";

export const en: Dict = {
    ...common,
    ...nav,
    ...reading,
    ...hackernews,
    ...reader,
    ...documents,
    ...dashboard,
    ...calendar,
    ...discover,
    ...vocabulary,
    ...search,
    ...chat,
    ...settings,
    ...wordModal,
    ...aichat,
    ...tts,
    ...voice,
    ...feeds,
    ...podcast,
    ...tools,
    ...toolsPage,
    ...music,
    ...browser,
    ...floatingBrowser,
    ...dsh,
    ...updater,
};
