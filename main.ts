import { App, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { ArxivSummarizer } from './summarizer';
import { ArxivMetadata } from './metadata';
import { ArxivSearch } from './search';

interface MyPluginSettings {
    openaiApiKey: string;
    translate: boolean;
    targetLanguage: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    openaiApiKey: '',
    translate: false,
    targetLanguage: '한국어'
}

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;
    summarizer: ArxivSummarizer;
    metadata: ArxivMetadata;
    search: ArxivSearch;

    async onload() {
        await this.loadSettings();

        this.summarizer = new ArxivSummarizer(this.app, this);
        this.metadata = new ArxivMetadata(this.app, this);
        this.search = new ArxivSearch(this.app, this);

        this.addRibbonIcon('dice', 'Arxiv Summarization', () => {
            this.summarizer.openModal();
        });

        this.addCommand({
            id: 'open-arxiv-summarization-modal',
            name: 'Summarize Arxiv Paper',
            callback: () => {
                this.summarizer.summarizeFromClipboard();
            }
        });

        this.addCommand({
            id: 'fetch-arxiv-metadata',
            name: 'Arxiv 메타데이터 가져오기',
            callback: () => {
                this.metadata.fetchMetadataFromClipboard();
            }
        });

        this.addCommand({
            id: 'search-arxiv',
            name: 'Arxiv 검색',
            callback: () => {
                this.search.searchArxiv();
            }
        });

        this.addSettingTab(new SampleSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class SampleSettingTab extends PluginSettingTab {
    plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('Enter your OpenAI API key')
            .addText(text => text
                .setPlaceholder('sk-...')
                .setValue(this.plugin.settings.openaiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openaiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('번역 활성화')
            .setDesc('요약문을 번역할지 선택합니다.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.translate)
                .onChange(async (value) => {
                    this.plugin.settings.translate = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.translate) {
            new Setting(containerEl)
                .setName('목표 언어')
                .setDesc('번역할 언어를 선택합니다.')
                .addDropdown(dropdown => dropdown
                    .addOption('한국어', '한국어')
                    .addOption('Japanese', '일본어')
                    .addOption('Chinese', '중국어')
                    .addOption('Spanish', '스페인어')
                    .addOption('French', '프랑스어')
                    .addOption('German', '독일어')
                    .setValue(this.plugin.settings.targetLanguage)
                    .onChange(async (value) => {
                        this.plugin.settings.targetLanguage = value;
                        await this.plugin.saveSettings();
                    }));
        }
    }
}
