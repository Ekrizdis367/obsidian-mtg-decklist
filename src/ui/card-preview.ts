import { useTouchCardUi } from "../utils/touch-ui";
import type { ImageQuality } from "../settings";
import type { ScryfallCard } from "../scryfall/types";
import { localizedDisplayName } from "../scryfall/localization";
import type { CardLanguage } from "../settings";
import { t } from "../utils/i18n";

const PREVIEW_MARGIN = 12;

export class CardPreview {
	constructor(private readonly currentLanguage: () => CardLanguage = () => "en") {}
	private el: HTMLElement | null = null;
	private overlay: HTMLElement | null = null;
	private currentImageUrl: string | null = null;

	private ensureEl(): HTMLElement {
		if (this.el) return this.el;
		const el = activeDocument.body.createDiv({ cls: "mtg-card-preview is-hidden" });
		this.el = el;
		return el;
	}

	private ensureOverlay(): HTMLElement {
		if (this.overlay) return this.overlay;
		const overlay = activeDocument.body.createDiv({ cls: "mtg-card-preview-overlay is-hidden" });
		overlay.addEventListener("click", () => this.hide());
		this.overlay = overlay;
		return overlay;
	}

	private pickImageUrl(card: ScryfallCard, quality: ImageQuality): string | null {
		const fromUris = (uris?: { small?: string; normal?: string; large?: string; png?: string }) => {
			if (!uris) return null;
			if (quality === "png") return uris.png ?? uris.large ?? uris.normal ?? uris.small ?? null;
			return uris[quality] ?? uris.normal ?? uris.large ?? uris.small ?? null;
		};
		const direct = fromUris(card.image_uris);
		if (direct) return direct;
		const face = card.card_faces?.[0]?.image_uris;
		return fromUris(face);
	}

	showHover(card: ScryfallCard, anchor: HTMLElement, quality: ImageQuality): void {
		const url = this.pickImageUrl(card, quality);
		if (!url) return;
		const el = this.ensureEl();

		if (this.currentImageUrl !== url) {
			el.empty();
			const img = el.createEl("img", { cls: "mtg-card-preview-img" });
			img.src = url;
			img.alt = localizedDisplayName(card, card);
			this.currentImageUrl = url;
		}

		el.removeClass("is-hidden");
		this.position(el, anchor);
	}

	showTap(card: ScryfallCard, quality: ImageQuality): void {
		const overlay = this.ensureOverlay();
		const url = this.pickImageUrl(card, quality);
		if (!url) return;

		overlay.empty();
		const inner = overlay.createDiv({ cls: "mtg-card-preview-overlay-inner" });
		const img = inner.createEl("img", { cls: "mtg-card-preview-img" });
		img.src = url;
		img.alt = localizedDisplayName(card, card);

		if (card.scryfall_uri) {
			const actions = inner.createDiv({ cls: "mtg-card-preview-tap-actions" });
			const open = actions.createEl("a", {
				cls: "mtg-card-preview-open-scryfall",
				text: t(this.currentLanguage(), "Open in browser"),
				href: card.scryfall_uri,
			});
			open.setAttribute("target", "_blank");
			open.setAttribute("rel", "noopener noreferrer");
			open.addEventListener("click", (ev) => {
				ev.stopPropagation();
				this.hide();
			});
		}

		overlay.removeClass("is-hidden");
	}

	show(card: ScryfallCard, anchor: HTMLElement, quality: ImageQuality): void {
		if (useTouchCardUi()) {
			this.showTap(card, quality);
		} else {
			this.showHover(card, anchor, quality);
		}
	}

	hide(): void {
		if (this.el) this.el.addClass("is-hidden");
		if (this.overlay) this.overlay.addClass("is-hidden");
	}

	destroy(): void {
		this.el?.remove();
		this.overlay?.remove();
		this.el = null;
		this.overlay = null;
		this.currentImageUrl = null;
	}

	private position(el: HTMLElement, anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let left = rect.right + PREVIEW_MARGIN;
		if (left + elRect.width > vw - PREVIEW_MARGIN) {
			left = Math.max(PREVIEW_MARGIN, rect.left - elRect.width - PREVIEW_MARGIN);
		}

		let top = rect.top;
		if (top + elRect.height > vh - PREVIEW_MARGIN) {
			top = Math.max(PREVIEW_MARGIN, vh - elRect.height - PREVIEW_MARGIN);
		}

		el.setCssStyles({
			left: `${left}px`,
			top: `${top}px`,
		});
	}
}
