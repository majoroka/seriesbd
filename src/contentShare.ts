import type { MediaType, Series } from './types';
import { fromScopedMovieId } from './media';

export type ContentShareDestination = {
    id: 'whatsapp' | 'facebook' | 'x' | 'email';
    label: string;
    iconClass: string;
    href: string;
};

export type ShareableMedia = Pick<Series, 'id' | 'media_type' | 'source_provider' | 'source_id' | 'name'>;

const SUPPORTED_BOOK_PROVIDERS = new Set(['google_books', 'open_library', 'goodreads']);

function parsePositiveId(value: unknown): number | null {
    const parsed = Number(String(value ?? '').trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOrigin(origin: string): string | null {
    try {
        const url = new URL(origin);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return url.origin;
    } catch {
        return null;
    }
}

function getMovieTmdbId(media: ShareableMedia): number | null {
    const sourceId = parsePositiveId(media.source_id);
    if (sourceId) return sourceId;
    return parsePositiveId(fromScopedMovieId(media.id));
}

export function createPublicContentShareUrl(media: ShareableMedia, origin: string): string | null {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) return null;

    if (media.media_type === 'series') {
        const tmdbId = parsePositiveId(media.id);
        return tmdbId ? `${normalizedOrigin}/partilhar/serie/${tmdbId}` : null;
    }

    if (media.media_type === 'movie') {
        const tmdbId = getMovieTmdbId(media);
        return tmdbId ? `${normalizedOrigin}/partilhar/filme/${tmdbId}` : null;
    }

    const provider = String(media.source_provider || '').trim();
    const sourceId = String(media.source_id || '').trim();
    if (!SUPPORTED_BOOK_PROVIDERS.has(provider) || !sourceId) return null;
    return `${normalizedOrigin}/partilhar/livro/${encodeURIComponent(provider)}/${encodeURIComponent(sourceId)}`;
}

export function createContentShareText(media: Pick<Series, 'media_type' | 'name'>): string {
    const typeLabel: Record<MediaType, string> = {
        series: 'série',
        movie: 'filme',
        book: 'livro',
    };
    const name = String(media.name || '').trim() || typeLabel[media.media_type];
    return `Descobre ${name} no MediaDex.`;
}

export function getContentShareDestinations(title: string, text: string, url: string): ContentShareDestination[] {
    const message = `${text}\n${url}`;
    return [
        {
            id: 'whatsapp',
            label: 'WhatsApp',
            iconClass: 'fab fa-whatsapp',
            href: `https://wa.me/?text=${encodeURIComponent(message)}`,
        },
        {
            id: 'facebook',
            label: 'Facebook',
            iconClass: 'fab fa-facebook-f',
            href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
        },
        {
            id: 'x',
            label: 'X',
            iconClass: 'fab fa-x-twitter',
            href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
        },
        {
            id: 'email',
            label: 'Email',
            iconClass: 'fas fa-envelope',
            href: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`,
        },
    ];
}

export function shouldUseNativeContentShare(): boolean {
    return typeof navigator !== 'undefined'
        && typeof navigator.share === 'function'
        && typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches;
}

export async function copyContentShareUrl(url: string): Promise<boolean> {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            return true;
        }
    } catch {
        // Fall through to the legacy copy command for restrictive browser contexts.
    }

    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
}
