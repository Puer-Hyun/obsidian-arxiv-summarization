import { App, Notice, Editor, requestUrl } from 'obsidian';
import MyPlugin from './main';

export class ArxivSearch {
    private app: App;
    private plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async searchArxiv() {
        const editor = this.getActiveMarkdownEditor();
        if (!editor) {
            new Notice('활성화된 마크다운 파일이 없습니다.');
            return;
        }

        const selectedText = editor.getSelection().trim();
        if (!selectedText) {
            new Notice('검색할 텍스트를 선택해주세요.');
            return;
        }

        const query = `ti:"${selectedText.replace(/ /g, "+")}"`;
        try {
            const result = await this.fetchArxivData(query);
            const parsedResult = this.parseArxivResponse(result);
            console.log(parsedResult);
            new Notice('검색 결과가 콘솔에 출력되었습니다.');
        } catch (e) {
            console.error(`오류: ${e.message}`);
            new Notice(`오류: ${e.message}`);
        }
    }

    private getActiveMarkdownEditor(): Editor | null {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        return view ? view.editor : null;
    }

    async fetchArxivData(query: string, maxRetries = 10) {
        const url = `https://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=3`;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await requestUrl({ url });
                if (response.status !== 200) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.text;
            } catch (e) {
                console.log(`시도 ${attempt + 1} 실패: ${e.message}`);
                if (attempt < maxRetries - 1) {
                    console.log("5초 후 재시도합니다...");
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    console.log("최대 재시도 횟수에 도달했습니다. 종료합니다.");
                    throw e;
                }
            }
        }
    }

    parseArxivResponse(xml: string) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, "application/xml");
        const entries = doc.getElementsByTagName("entry");
        let output = "";

        for (let entry of entries) {
            const id = entry.getElementsByTagName("id")[0].textContent;
            const published = entry.getElementsByTagName("published")[0].textContent;
            const title = entry.getElementsByTagName("title")[0].textContent;
            const summary = entry.getElementsByTagName("summary")[0].textContent;
            const authors = Array.from(entry.getElementsByTagName("author")).map(author => author.getElementsByTagName("name")[0].textContent).join(", ");

            output += `ID: ${id}\n`;
            output += `Published: ${published}\n`;
            output += `Title: ${title}\n`;
            output += `Summary: ${summary}\n`;
            output += `Authors: ${authors}\n\n`;
        }

        return output;
    }
}