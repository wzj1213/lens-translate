# Lens Translate

[中文使用说明](README.md)

Read a page with a translation under each paragraph, or select a phrase to translate on its own. Translate on device with Chrome or connect a model you choose. Lens also reads captions, PDFs and screenshots and translates drafts in editable fields.

## Install in Chrome

1. Download the built extension and extract it to a folder you intend to keep. [Download Lens Translate 1.1.0 (ZIP)](downloads/lens-translate-1.1.0.zip?raw=true)
2. In Chrome 114 or later, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the folder that directly contains `manifest.json`.
3. Open the puzzle-piece menu in the Chrome toolbar and pin Lens. Click its icon, then the gear in the top right of the popup.

## Try it without an API key

In desktop Chrome 138 or later, open an HTTPS article and click **Translate this page**. Click **Download language pack** on the page when prompted. After the initial download, Chrome translates supported language pairs on your device. Choose your reading language under **Settings → Translate**. Availability depends on your device, browser policies and language pair. [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)

For contextual explanations, terminology across batches or additional languages, connect a model below. To switch back, choose **Chrome on-device translation** under **Connection → Active engine** and save.

## Connect a model

| | Cloud example · DeepSeek | Local example · Ollama |
| --- | --- | --- |
| Before you start | Create a key in your DeepSeek API account. API usage is billed by the provider. [Create a key](https://platform.deepseek.com/api_keys) | Install and start Ollama on the same computer as Chrome. Run `ollama pull qwen2.5:7b`, then check the exact model name with `ollama ls`. [Get Ollama](https://ollama.com/download) |
| Provider preset | `DeepSeek` | `Custom` |
| Protocol | OpenAI compatible | OpenAI compatible |
| Endpoint | `https://api.deepseek.com/chat/completions` (prefilled) | `http://localhost:11434/v1` |
| API key | Your DeepSeek key | Leave blank for the default local installation |
| Model | `deepseek-flash` (prefilled) | `qwen2.5:7b` or the exact name shown by `ollama ls` |

Choose a target language under **Translate**. The default is Simplified Chinese. Click **Test connection** and wait for a sample translation, then click **Save settings**.

If Ollama returns `403`, copy the extension ID from `chrome://extensions`, add `chrome-extension://YOUR_EXTENSION_ID` to Ollama’s `OLLAMA_ORIGINS`, and restart Ollama. [Ollama origin settings](https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama)

## Try it

Open an article in a language different from your target. Click the floating button at the bottom right or **Translate this page** in the popup. Use **Restore original** to return to the original. To translate a phrase, select it and click **Translate selection**. If the tab was open during installation, reload it first.

![A sample English article with a Chinese translation below each paragraph](docs/images/bilingual-reading.png)

## Reading and writing

| Task | How to use it |
| --- | --- |
| Read one paragraph | Point to it and tap Alt (Option on macOS). Tap again to hide the translation. Choose Shift or turn this off in translation settings. |
| Understand a word in context | Select a word or phrase in a sentence. With a model, Lens explains its meaning there. The on-device engine translates the word and the sentence. |
| Translate a draft | Set **Writing language** (English by default). Right-click the focused field to translate it. A prefix such as `/ja See you tomorrow` overrides the language for one draft. Press Esc or choose **Restore original draft** to undo. |
| Read GitHub | Page translation uses built-in rules for issue and PR titles, Markdown and comments. Code and diffs are skipped. |
| Keep terminology consistent | With a configured model, long pages use one extra request to derive a topic and up to 12 recurring terms for later batches. Your manual glossary takes priority. You can disable this in translation settings. |
| Watch YouTube | Enable CC on a video with an existing caption track, then select **Bilingual captions** in the popup. Seeking and track changes follow the current cue. |
| Read a PDF | Open **PDF & image reader** from the popup and choose a text-layer PDF. Click a paragraph to show its source and translation alongside the original graphics. Direct PDF links can open automatically. Save private documents locally first. |
| Translate an image | Right-click an image and choose **Read and translate image**, or open a file in the reader. OCR runs locally with bundled English, Simplified Chinese and Japanese models. Correct the recognized text and click **Translate text** to retry. |

![PDF reader showing a selected paragraph and its sample translation alongside the original chart](docs/images/pdf-reader.png)

## Data and development

On-device translation, image recognition and PDF parsing run locally. In provider mode, Lens can include the selected sentence or a long-page excerpt of up to 5,500 characters. Recognized email addresses and phone numbers are replaced before requests and restored in the translation. The provider receives extracted or selected text. The reader fetches online files from their source.

Lens sends text, the target language, applicable glossary terms, and sometimes the page title and hostname to your configured endpoint. Automatic translation is off by default. API keys, preferences, and cached translations are stored in the browser. Clearing the translation cache and exporting settings are available in Settings. The API key is included in a backup only if you explicitly select the plain-text export option.

To build from source, use Node.js 22.13+ LTS and run `npm ci`, then `npm run build`. Load the resulting `dist/` folder in Chrome. Run `npm run typecheck` and `npm test` to check changes, or `npm run package` to rebuild the downloadable ZIP. [MIT license](LICENSE)

To contribute a site profile, add an exact `host`, a `path` regular expression, and `include` / `exclude` CSS selectors to [siteProfiles.json](src/features/translate/content/siteProfiles.json). Include an example URL and the expected translated and excluded elements in your PR. Bundled PDF, OCR and font licenses are listed in the [third-party notices](THIRD_PARTY_NOTICES.md).
