export interface ParsedTelegramPost {
  url: string;
  postedAt: string;
  text: string;
  isForward: boolean;
  isQuote: boolean;
  referencedUrl?: string;
}

interface MutableTelegramPost {
  dataPost: string;
  url?: string;
  postedAt?: string;
  text: string;
  isForward: boolean;
  isQuote: boolean;
  forwardedUrl?: string;
  quotedUrl?: string;
}

function cleanText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function absoluteTelegramUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, "https://t.me").toString();
  } catch {
    return undefined;
  }
}

/** Parse Telegram's public channel preview without executing page scripts. */
export async function parseTelegramPreview(html: string): Promise<ParsedTelegramPost[]> {
  const posts: MutableTelegramPost[] = [];
  let current: MutableTelegramPost | undefined;

  const rewriter = new HTMLRewriter()
    .on(".tgme_widget_message[data-post]", {
      element(element) {
        const dataPost = element.getAttribute("data-post");
        if (!dataPost) return;
        current = {
          dataPost,
          text: "",
          isForward: false,
          isQuote: false,
        };
        posts.push(current);
      },
    })
    .on(".tgme_widget_message_text", {
      text(text) {
        if (current) current.text += text.text;
      },
    })
    .on(".tgme_widget_message_text br", {
      element() {
        if (current) current.text += "\n";
      },
    })
    .on(".tgme_widget_message_text img[alt]", {
      element(element) {
        if (current) current.text += element.getAttribute("alt") ?? "";
      },
    })
    .on(".tgme_widget_message_forwarded_from", {
      element() {
        if (current) current.isForward = true;
      },
    })
    .on(".tgme_widget_message_forwarded_from a[href]", {
      element(element) {
        if (current) current.forwardedUrl = absoluteTelegramUrl(element.getAttribute("href"));
      },
    })
    .on(".tgme_widget_message_reply", {
      element() {
        if (current) current.isQuote = true;
      },
    })
    .on(".tgme_widget_message_reply a[href]", {
      element(element) {
        if (current && !current.quotedUrl) {
          current.quotedUrl = absoluteTelegramUrl(element.getAttribute("href"));
        }
      },
    })
    .on(".tgme_widget_message_date[href]", {
      element(element) {
        if (current) current.url = absoluteTelegramUrl(element.getAttribute("href"));
      },
    })
    .on(".tgme_widget_message_date time[datetime]", {
      element(element) {
        if (current) current.postedAt = element.getAttribute("datetime") ?? undefined;
      },
    });

  await rewriter.transform(new Response(html)).text();

  return posts.flatMap((post) => {
    const text = cleanText(post.text);
    const url = post.url ?? absoluteTelegramUrl(`/${post.dataPost}`);
    if (!url || !post.postedAt || !text) return [];

    const timestamp = new Date(post.postedAt);
    if (Number.isNaN(timestamp.valueOf())) return [];

    return [
      {
        url,
        postedAt: timestamp.toISOString(),
        text,
        isForward: post.isForward,
        isQuote: post.isQuote,
        referencedUrl: post.quotedUrl ?? post.forwardedUrl,
      },
    ];
  });
}