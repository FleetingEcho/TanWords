import { EnrichmentInput } from "@/hooks/useDB";

export interface BasicWord {
  word: string;
  zh: string;
  level: string;
  word_type: string;
  ipa?: string;
}

export interface EnrichedWord extends BasicWord {
  enrichment: EnrichmentInput;
}

/** 5 hand-written freeform explanations, in the shape the AI-generated
 * enrichment now takes (see providers/base.ts buildEnrichSystemPrompt). */
export const ENRICHED_SEED_WORDS: EnrichedWord[] = [
  {
    word: "resilient", zh: "有韧性的；恢复力强的", level: "C1", word_type: "adj", ipa: "/rɪˈzɪliənt/",
    enrichment: {
      zhShort: "有韧性的",
      level: "C1",
      text: `**核心释义**：形容人或系统能从困境、压力中快速恢复——不是"不受打击"，而是"打了能回来"。也可以指材料有弹性，压了能弹回原状。

> Children are often remarkably resilient.
> 孩子们通常有着惊人的适应力。

> A resilient rubber sole that absorbs impact.
> 吸收冲击力的弹性橡胶鞋底。

**近义词辨析**：tough 更口语、强调硬扛；adaptable 侧重适应新环境；hardy 多指体质强壮耐受。反义词：fragile、brittle、vulnerable。

**常见搭配**：resilient economy · emotionally resilient · resilient supply chain · remain resilient

**词源**：源自拉丁语 resilire（回弹），17 世纪进入英语，先指物质弹性，后引申为心理复原力。re-（回/重新）+ salire（跳跃）。

**记忆法**：re(回) + sili(跳) —— 压力下能"回跳"回来 → 有韧性的

**派生词**：resilience（n. 韧性）、resiliently（adv. 有韧性地）`,
    },
  },
  {
    word: "paradigm", zh: "范式；典范", level: "C1", word_type: "n", ipa: "/ˈpærədaɪm/",
    enrichment: {
      zhShort: "范式；典范",
      level: "C1",
      text: `**核心释义**：某一领域公认的典型模式或思维框架，常用于描述认知/方法论上的整体转变。

> This represents a paradigm shift in computing.
> 这代表了计算领域的范式转变。

**常见搭配**：paradigm shift（范式转变，最高频）· dominant paradigm · new paradigm · within the paradigm

**近义词**：model（更通用）、framework（侧重结构）、template（指可复制的模板）。

**词源**：源自希腊语 para-（在旁边）+ deiknynai（显示）——"在旁边展示出来供模仿的范例"。

**记忆法**：para(旁) + digm(示范) —— 站在旁边给你"示范"的东西 → 范式

**权威引用**：
> Science advances through paradigm shifts, not incremental improvements.
> —— Thomas Kuhn, *The Structure of Scientific Revolutions*`,
    },
  },
  {
    word: "ubiquitous", zh: "无处不在的；普遍的", level: "C2", word_type: "adj", ipa: "/juːˈbɪkwɪtəs/",
    enrichment: {
      zhShort: "无处不在的",
      level: "C2",
      text: `**核心释义**：形容某事物极其普遍，仿佛同时出现在每个地方——语气比 widespread 更强，常带一点"渗透到生活各处"的意味。

> Smartphones have become ubiquitous.
> 智能手机已经变得无处不在。

**近义词辨析**：omnipresent 更正式，常用于神或抽象概念；pervasive 强调渗透性、蔓延性；widespread 更日常，指分布广泛。反义词：rare、scarce、uncommon。

**常见搭配**：ubiquitous computing · become ubiquitous · ubiquitous presence

**词源**：源自拉丁语 ubique（到处），由 ubi（在哪里）+ quit-（每一个）构成，字面意思是"在每一个地方"。

**记忆法**：ubi(在哪) + quit(离开) + ous —— "无论在哪都离不开" → 无处不在

**派生词**：ubiquity（n. 无处不在）、ubiquitously（adv.）`,
    },
  },
  {
    word: "mitigate", zh: "减轻；缓和；降低（风险）", level: "C1", word_type: "v", ipa: "/ˈmɪtɪɡeɪt/",
    enrichment: {
      zhShort: "减轻；缓和",
      level: "C1",
      text: `**核心释义**：使（风险、损害、严重程度）变轻——是一个偏正式/书面的动词，常见于政策、商业、医学语境。

> We need to mitigate the risks.
> 我们需要降低风险。

> Diversification can mitigate the impact of market volatility.
> 分散投资可以降低市场波动带来的影响。

**近义词辨析**：alleviate 侧重减轻痛苦；reduce 更通用；diminish 强调缩小程度。反义词：aggravate、exacerbate、worsen。

**常见搭配**：mitigate risk · mitigate damage · mitigate the effects of · measures to mitigate

**词源**：源自拉丁语 mitigare（使变柔和），由 mitis（柔和的）+ agere（做）构成。

**记忆法**：miti(柔) + gate(门) —— 把"硬门"变软 → 减轻、缓和

**派生词**：mitigation（n. 缓解）、mitigating（adj.，如 mitigating circumstances 减轻情节）`,
    },
  },
  {
    word: "pragmatic", zh: "务实的；注重实效的", level: "C1", word_type: "adj", ipa: "/præɡˈmætɪk/",
    enrichment: {
      zhShort: "务实的",
      level: "C1",
      text: `**核心释义**：看重实际效果而非理论/理想的处事风格——做决策时先问"这样做行不行得通"，而不是"这样对不对"。

> A pragmatic approach to problem-solving.
> 务实的解决问题方式。

> The CEO took a pragmatic approach to the restructuring.
> CEO 对这次重组采取了务实的态度。

**近义词辨析**：practical 更日常，指可操作的；realistic 强调正视现实；utilitarian 强调功用性。反义词：idealistic、impractical、utopian。

**常见搭配**：pragmatic approach · pragmatic solution · be pragmatic about

**词源**：源自希腊语 pragma（行动、实际的事），注重"实际行动"而非空谈。

**记忆法**：pragma(行动) + tic —— 注重"行动"的 → 务实的

**派生词**：pragmatism（n. 实用主义）、pragmatist（n. 实用主义者）、pragmatically（adv.）`,
    },
  },
];

/** 80 basic words (word + zh + level + type) */
export const BASIC_SEED_WORDS: BasicWord[] = [
  { word: "ambiguous", zh: "模棱两可的；歧义的", level: "C1", word_type: "adj", ipa: "/æmˈbɪɡjuəs/" },
  { word: "leverage", zh: "利用；杠杆作用", level: "B2", word_type: "v/n", ipa: "/ˈliːvərɪdʒ/" },
  { word: "nuance", zh: "细微差别；微妙之处", level: "C1", word_type: "n", ipa: "/ˈnjuːɑːns/" },
  { word: "meticulous", zh: "细心的；一丝不苟的", level: "C1", word_type: "adj", ipa: "/məˈtɪkjələs/" },
  { word: "eloquent", zh: "口才流利的；有说服力的", level: "C1", word_type: "adj", ipa: "/ˈeləkwənt/" },
  { word: "ephemeral", zh: "短暂的；转瞬即逝的", level: "C2", word_type: "adj", ipa: "/ɪˈfemərəl/" },
  { word: "verbose", zh: "冗长的；啰嗦的", level: "C1", word_type: "adj", ipa: "/vɜːˈboʊs/" },
  { word: "concise", zh: "简明的；简洁的", level: "B2", word_type: "adj", ipa: "/kənˈsaɪs/" },
  { word: "scrutinize", zh: "仔细审查；细看", level: "C1", word_type: "v", ipa: "/ˈskruːtənaɪz/" },
  { word: "iterate", zh: "迭代；反复", level: "B2", word_type: "v", ipa: "/ˈɪtəreɪt/" },
  { word: "abstraction", zh: "抽象；抽象层", level: "C1", word_type: "n", ipa: "/æbˈstrækʃn/" },
  { word: "idempotent", zh: "幂等的（多次调用结果一致）", level: "C2", word_type: "adj", ipa: "/ˌaɪdɛmˈpoʊtənt/" },
  { word: "throughput", zh: "吞吐量", level: "B2", word_type: "n", ipa: "/ˈθruːpʊt/" },
  { word: "latency", zh: "延迟；潜伏期", level: "B2", word_type: "n", ipa: "/ˈleɪtənsi/" },
  { word: "concurrency", zh: "并发；同时性", level: "C1", word_type: "n", ipa: "/kənˈkɜːrənsi/" },
  { word: "heuristic", zh: "启发式的；经验法则", level: "C1", word_type: "adj/n", ipa: "/hjʊˈrɪstɪk/" },
  { word: "empirical", zh: "以经验为依据的；实证的", level: "C1", word_type: "adj", ipa: "/ɪmˈpɪrɪkl/" },
  { word: "perpetual", zh: "永久的；持续的", level: "C1", word_type: "adj", ipa: "/pərˈpetʃuəl/" },
  { word: "arbitrary", zh: "任意的；随机的", level: "C1", word_type: "adj", ipa: "/ˈɑːrbɪtreri/" },
  { word: "coherent", zh: "连贯的；条理清晰的", level: "C1", word_type: "adj", ipa: "/koʊˈhɪrənt/" },
  { word: "prevalent", zh: "普遍的；流行的", level: "C1", word_type: "adj", ipa: "/ˈprevələnt/" },
  { word: "volatile", zh: "不稳定的；易变的", level: "C1", word_type: "adj", ipa: "/ˈvɒlətaɪl/" },
  { word: "obsolete", zh: "过时的；废弃的", level: "C1", word_type: "adj", ipa: "/ˈɒbsəliːt/" },
  { word: "intrinsic", zh: "内在的；固有的", level: "C2", word_type: "adj", ipa: "/ɪnˈtrɪnzɪk/" },
  { word: "exacerbate", zh: "使恶化；加剧", level: "C2", word_type: "v", ipa: "/ɪɡˈzæsərbeɪt/" },
  { word: "alleviate", zh: "减轻；缓解", level: "C1", word_type: "v", ipa: "/əˈliːvieɪt/" },
  { word: "articulate", zh: "表达清楚的；口齿清晰的", level: "C1", word_type: "adj/v", ipa: "/ɑːrˈtɪkjələt/" },
  { word: "catalyst", zh: "催化剂；推动因素", level: "C1", word_type: "n", ipa: "/ˈkætəlɪst/" },
  { word: "consensus", zh: "共识；一致意见", level: "B2", word_type: "n", ipa: "/kənˈsensəs/" },
  { word: "discrepancy", zh: "差异；不一致", level: "C1", word_type: "n", ipa: "/dɪˈskrepənsi/" },
  { word: "diligent", zh: "勤奋的；用心的", level: "B2", word_type: "adj", ipa: "/ˈdɪlɪdʒənt/" },
  { word: "erratic", zh: "不规则的；反复无常的", level: "C1", word_type: "adj", ipa: "/ɪˈrætɪk/" },
  { word: "feasible", zh: "可行的；切实可行的", level: "B2", word_type: "adj", ipa: "/ˈfiːzəbl/" },
  { word: "substantial", zh: "大量的；实质性的", level: "B2", word_type: "adj", ipa: "/səbˈstænʃl/" },
  { word: "ambivalent", zh: "矛盾的；态度不明确的", level: "C1", word_type: "adj", ipa: "/æmˈbɪvələnt/" },
  { word: "precarious", zh: "不稳定的；危险的", level: "C1", word_type: "adj", ipa: "/prɪˈkeəriəs/" },
  { word: "rigorous", zh: "严格的；缜密的", level: "C1", word_type: "adj", ipa: "/ˈrɪɡərəs/" },
  { word: "scrutiny", zh: "仔细审查；严格检查", level: "C1", word_type: "n", ipa: "/ˈskruːtəni/" },
  { word: "tangible", zh: "有形的；切实的", level: "C1", word_type: "adj", ipa: "/ˈtændʒɪbl/" },
  { word: "intangible", zh: "无形的；难以捉摸的", level: "C1", word_type: "adj", ipa: "/ɪnˈtændʒɪbl/" },
  { word: "unprecedented", zh: "前所未有的；空前的", level: "C1", word_type: "adj", ipa: "/ʌnˈpresɪdentɪd/" },
  { word: "infer", zh: "推断；推论", level: "C1", word_type: "v", ipa: "/ɪnˈfɜːr/" },
  { word: "hypothesis", zh: "假设；假说", level: "B2", word_type: "n", ipa: "/haɪˈpɒθəsɪs/" },
  { word: "magnitude", zh: "规模；重要性；震级", level: "C1", word_type: "n", ipa: "/ˈmæɡnɪtjuːd/" },
  { word: "manifest", zh: "清单；显现；明显的", level: "C1", word_type: "v/adj/n", ipa: "/ˈmænɪfest/" },
  { word: "negligible", zh: "可忽略的；微不足道的", level: "C1", word_type: "adj", ipa: "/ˈneɡlɪdʒɪbl/" },
  { word: "oversight", zh: "监督；疏忽", level: "C1", word_type: "n", ipa: "/ˈoʊvərsaɪt/" },
  { word: "paramount", zh: "至高无上的；最重要的", level: "C1", word_type: "adj", ipa: "/ˈpærəmaʊnt/" },
  { word: "pivotal", zh: "关键的；核心的", level: "C1", word_type: "adj", ipa: "/ˈpɪvətl/" },
  { word: "proliferate", zh: "激增；扩散", level: "C2", word_type: "v", ipa: "/prəˈlɪfəreɪt/" },
  { word: "refine", zh: "改进；精炼", level: "B2", word_type: "v", ipa: "/rɪˈfaɪn/" },
  { word: "reframe", zh: "重新定义；换个角度看", level: "C1", word_type: "v", ipa: "/ˌriːˈfreɪm/" },
  { word: "robust", zh: "稳健的；强壮的", level: "C1", word_type: "adj", ipa: "/roʊˈbʌst/" },
  { word: "scalable", zh: "可扩展的；可伸缩的", level: "C1", word_type: "adj", ipa: "/ˈskeɪləbl/" },
  { word: "streamline", zh: "精简；使更有效率", level: "C1", word_type: "v", ipa: "/ˈstriːmlaɪn/" },
  { word: "suppress", zh: "压制；镇压；抑制", level: "C1", word_type: "v", ipa: "/səˈpres/" },
  { word: "synthesize", zh: "综合；合成", level: "C1", word_type: "v", ipa: "/ˈsɪnθəsaɪz/" },
  { word: "tedious", zh: "单调乏味的；冗长的", level: "B2", word_type: "adj", ipa: "/ˈtiːdiəs/" },
  { word: "transition", zh: "过渡；转变", level: "B2", word_type: "n/v", ipa: "/trænˈzɪʃn/" },
  { word: "validate", zh: "验证；确认有效性", level: "B2", word_type: "v", ipa: "/ˈvælɪdeɪt/" },
  { word: "ambiguity", zh: "模糊性；不明确", level: "C1", word_type: "n", ipa: "/ˌæmbɪˈɡjuːəti/" },
  { word: "imperative", zh: "必要的；紧迫的；祈使句", level: "C1", word_type: "adj/n", ipa: "/ɪmˈperətɪv/" },
  { word: "inherent", zh: "固有的；内在的", level: "C1", word_type: "adj", ipa: "/ɪnˈhɪrənt/" },
  { word: "intuitive", zh: "直觉的；易懂的", level: "C1", word_type: "adj", ipa: "/ɪnˈtjuːɪtɪv/" },
  { word: "plausible", zh: "似乎合理的；可信的", level: "C1", word_type: "adj", ipa: "/ˈplɔːzɪbl/" },
  { word: "redundant", zh: "多余的；冗余的；被裁员的", level: "C1", word_type: "adj", ipa: "/rɪˈdʌndənt/" },
  { word: "systematic", zh: "系统的；有条不紊的", level: "B2", word_type: "adj", ipa: "/ˌsɪstəˈmætɪk/" },
  { word: "transient", zh: "短暂的；临时的", level: "C1", word_type: "adj", ipa: "/ˈtrænziənt/" },
  { word: "leverage", zh: "杠杆；影响力；利用", level: "B2", word_type: "n/v", ipa: "/ˈliːvərɪdʒ/" },
  { word: "momentum", zh: "动力；势头；动量", level: "C1", word_type: "n", ipa: "/məˈmentəm/" },
  { word: "cognitive", zh: "认知的；认识的", level: "C1", word_type: "adj", ipa: "/ˈkɒɡnɪtɪv/" },
  { word: "benchmark", zh: "基准；参照标准", level: "B2", word_type: "n/v", ipa: "/ˈbentʃmɑːrk/" },
  { word: "deprecate", zh: "不赞成；标记为废弃", level: "C1", word_type: "v", ipa: "/ˈdeprəkeɪt/" },
  { word: "aggregate", zh: "聚合；总计；集合", level: "C1", word_type: "v/adj/n", ipa: "/ˈæɡrɪɡət/" },
  { word: "propagate", zh: "传播；繁殖；传递", level: "C1", word_type: "v", ipa: "/ˈprɒpəɡeɪt/" },
  { word: "asynchronous", zh: "异步的", level: "C1", word_type: "adj", ipa: "/eɪˈsɪŋkrənəs/" },
  { word: "deterministic", zh: "确定性的", level: "C2", word_type: "adj", ipa: "/dɪˌtɜːrmɪˈnɪstɪk/" },
  { word: "encapsulate", zh: "封装；概括", level: "C1", word_type: "v", ipa: "/ɪnˈkæpsjuleɪt/" },
  { word: "eloquence", zh: "口才；雄辩", level: "C1", word_type: "n", ipa: "/ˈeləkwəns/" },
  { word: "deteriorate", zh: "恶化；变坏", level: "C1", word_type: "v", ipa: "/dɪˈtɪəriəreɪt/" },
  { word: "facilitate", zh: "促进；使便利", level: "C1", word_type: "v", ipa: "/fəˈsɪlɪteɪt/" },
];
