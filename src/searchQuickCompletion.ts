import type { MediaType } from './types';

export type SearchQuickCompletion =
    | {
        mode: 'released-episodes';
        title: 'Adicionar e Marcar Tudo Como Visto';
        iconClass: 'fas fa-check-double';
    }
    | {
        mode: 'progress';
        title: 'Adicionar e Marcar Como Visto' | 'Adicionar e Marcar Como Lido';
        iconClass: 'fas fa-check';
        progressPercent: 100;
    };

export function getSearchQuickCompletion(mediaType: MediaType): SearchQuickCompletion {
    if (mediaType === 'series') {
        return {
            mode: 'released-episodes',
            title: 'Adicionar e Marcar Tudo Como Visto',
            iconClass: 'fas fa-check-double',
        };
    }

    return {
        mode: 'progress',
        title: mediaType === 'movie' ? 'Adicionar e Marcar Como Visto' : 'Adicionar e Marcar Como Lido',
        iconClass: 'fas fa-check',
        progressPercent: 100,
    };
}
