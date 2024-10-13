import { App, Notice, Editor, MarkdownView, requestUrl } from 'obsidian';
import MyPlugin from './main';

interface ArxivPaper {
    id: string;
    published: string;
    title: string;
    summary: string;
    authors: string;
    citations: number;
}

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
            if (result) {
                const papers = await this.parseArxivResponse(result);
                const sortedPapers = await this.sortPapersByCitations(papers);
                this.displayResults(sortedPapers);
                new Notice('검색 결과가 콘솔에 출력되었습니다.');
            } else {
                new Notice('검색 결과가 없습니다.');
            }
        } catch (e) {
            console.error(`오류: ${e.message}`);
            new Notice(`오류: ${e.message}`);
        }
    }

    private getActiveMarkdownEditor(): Editor | null {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        return view ? view.editor : null;
    }

    async fetchArxivData(query: string, maxRetries = 10): Promise<string | null> {
        const url = `https://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=10`;
        
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
        return null;
    }

    async parseArxivResponse(xml: string): Promise<ArxivPaper[]> {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, "application/xml");
        const entries = Array.from(doc.getElementsByTagName("entry"));

        return entries.map(entry => ({
            id: entry.querySelector("id")?.textContent ?? "N/A",
            published: entry.querySelector("published")?.textContent ?? "N/A",
            title: entry.querySelector("title")?.textContent ?? "N/A",
            summary: entry.querySelector("summary")?.textContent ?? "N/A",
            authors: Array.from(entry.querySelectorAll("author name"))
                .map(author => author.textContent)
                .join(", "),
            citations: 0 // 초기값, 나중에 업데이트됨
        }));
    }

    async sortPapersByCitations(papers: ArxivPaper[]): Promise<ArxivPaper[]> {
        const papersWithCitations = await Promise.all(papers.map(async paper => {
            paper.citations = await this.getCitationCount(paper.id);
            return paper;
        }));

        return papersWithCitations.sort((a, b) => b.citations - a.citations).slice(0, 3);
    }

    async getCitationCount(arxivId: string): Promise<number> {
        // arXiv ID에서 버전 정보 제거
        const cleanArxivId = arxivId.replace(/v\d+$/, '');
        const semanticScholarId = cleanArxivId.replace('http://arxiv.org/abs/', 'arXiv:');
        const url = `https://api.semanticscholar.org/v1/paper/${semanticScholarId}`;

        console.log(`Fetching citation count for: ${semanticScholarId}`);

        try {
            const response = await requestUrl({ url });
            console.log(`Semantic Scholar API response status: ${response.status}`);

            if (response.status === 200) {
                const data = JSON.parse(response.text);
                console.log(`Citation data:`, data);
                if (data.numCitedBy !== undefined) {
                    console.log(`Citation count: ${data.numCitedBy}`);
                    return data.numCitedBy;
                } else {
                    console.log(`Citation count not found in response`);
                    return 0;
                }
            } else if (response.status === 404) {
                console.log(`Paper not found in Semantic Scholar: ${semanticScholarId}`);
                return 0;
            } else {
                console.error(`Unexpected response from Semantic Scholar API: ${response.status}`);
                console.error(`Response text:`, response.text);
                return 0;
            }
        } catch (error) {
            console.error(`Error fetching citation count for ${arxivId}:`, error);
            return 0;
        }
    }

    displayResults(papers: ArxivPaper[]) {
        papers.forEach(paper => {
            console.log(`Title: ${paper.title}`);
            console.log(`Authors: ${paper.authors}`);
            console.log(`Published: ${paper.published}`);
            console.log(`Citations: ${paper.citations}`);
            console.log(`Summary: ${paper.summary}`);
            console.log(`ID: ${paper.id}`);
            console.log('---');
        });
    }
}
