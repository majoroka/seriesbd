import type { Chart } from 'chart.js';

/**
 * Creates a DOM element with specified properties and children. A helper to prevent XSS.
 * @param {string} tag The HTML tag for the element.
 * @param {object} props Properties to set on the element. Special keys: 'text' for textContent, 'html' for innerHTML (use with caution).
 * @param {Array<Node|string>} children Child elements or text nodes to append.
 * @returns {HTMLElement} The created element.
 */
export function el(tag: string, props: Record<string, any> = {}, children: (Node | string | null | undefined)[] = []): HTMLElement {
    const element = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
        if (key === 'text') {
            element.textContent = value;
        } else if (key === 'html') { // Use only for trusted, static HTML
            element.innerHTML = value;
        } else {
            element.setAttribute(key, value);
        }
    });
    children.filter(Boolean).forEach(child => {
        if (child) element.appendChild(child instanceof Node ? child : document.createTextNode(child));
    });
    return element;
}

/**
 * Fetches a resource with exponential backoff retry logic.
 * @param {string} url The URL to fetch.
 * @param {object} options Fetch options, including the signal.
 * @param {number} retries Number of retries.
 * @param {number} backoff Initial backoff delay in ms.
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3, backoff = 1000): Promise<Response> {
    const { signal } = options;

    for (let i = 0; i < retries; i++) {
        try {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            const response = await fetch(url, options);

            // Retry on server errors (5xx), but not on client errors (4xx)
            if (response.status >= 500 && response.status < 600) {
                throw new Error(`Server error: ${response.status}`);
            }

            return response; // Success
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw error; // Don't retry if aborted
            }

            if (i === retries - 1) {
                throw error; // Last attempt failed, re-throw
            }

            const message = error instanceof Error ? error.message : String(error);
            console.warn(`Fetch failed for ${url}. Retrying in ${backoff / 1000}s... (Attempt ${i + 1}/${retries})`, message);
            
            // Wait for backoff period
            await new Promise(resolve => setTimeout(resolve, backoff));

            backoff *= 2; // Exponential backoff
        }
    }
    throw new Error('Fetch failed after all retries.');
}

/**
 * Debounces a function, delaying its execution. Also provides a `cancel` method.
 * @param {function} func The function to debounce.
 * @param {number} delay The delay in milliseconds.
 * @returns {function} The new debounced function with a `cancel` method.
 */
export function debounce<T extends (...args: any[]) => any>(func: T, delay: number): ((...args: Parameters<T>) => void) & { cancel: () => void } {
    let timeout: number;
    const debounced = function(this: ThisParameterType<T>, ...args: Parameters<T>) {
        const context = this;
        window.clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
    debounced.cancel = function() {
        clearTimeout(timeout);
    };
    return debounced;
}

/**
 * Traduz nomes de temporadas comuns do inglês para o português.
 * @param {string} originalName - O nome original da temporada vindo da API.
 * @param {number} seasonNumber - O número da temporada.
 * @returns {string} O nome traduzido ou o original.
 */
export function getTranslatedSeasonName(originalName: string, seasonNumber: number): string {
    if (!originalName) return `Temporada ${seasonNumber}`;
    const lowerCaseName = originalName.toLowerCase();
    if (lowerCaseName === 'specials') return 'Especiais';
    if (/^season \d+$/.test(lowerCaseName)) return `Temporada ${seasonNumber}`;
    return originalName;
}

/**
 * Formata uma data (string ou objeto Date) para uma string localizada.
 * @param {string | Date} date - A data a ser formatada.
 * @param {string} [locale='pt-PT'] - O locale a ser usado para a formatação.
 * @param {Intl.DateTimeFormatOptions} [options] - Opções de formatação.
 * @returns {string} A data formatada, ou uma string vazia se a data for inválida.
 */
export function formatDate(date: string | Date, locale: string = 'pt-PT', options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }): string {
    if (!date) return '';
    try {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(dateObj.getTime())) {
            return '';
        }
        return new Intl.DateTimeFormat(locale, options).format(dateObj);
    } catch (error) {
        console.error('Error formatting date:', error);
        return '';
    }
}

/**
 * Formata uma string de classificação etária para um formato mais simples.
 * @param {string} certString - A string de classificação original da API.
 * @returns {string} A string formatada.
 */
export function formatCertification(certString: string): string {
    if (!certString) return '';
    const upperCert = certString.toUpperCase();
    if (upperCert.includes('14')) return '14+';
    if (upperCert.includes('13')) return '13+';
    if (upperCert.includes('Y7')) return '7+';
    if (upperCert.includes('MA') || upperCert.includes('NC-17') || upperCert === 'R') return '18+';
    return ['PG', 'G'].find(c => upperCert.includes(c)) || certString;
}

/**
 * Formats a duration in minutes into a human-readable "Xh Ymin" string.
 * @param {number} totalMinutes 
 * @returns {string}
 */
export function formatHoursMinutes(totalMinutes: number): string {
    if (!totalMinutes || totalMinutes <= 0) return 'N/A';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}min`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}min`;
}

/**
 * Formats a duration in minutes into a human-readable string.
 * @param {number} totalMinutes 
 * @returns {string}
 */
export function formatDuration(totalMinutes: number): string {
    if (totalMinutes <= 0) return '0min';
    const MIN_IN_HOUR = 60;
    const MIN_IN_DAY = 24 * MIN_IN_HOUR;
    const MIN_IN_MONTH = 30 * MIN_IN_DAY;
    const MIN_IN_YEAR = 365 * MIN_IN_DAY;
    const years = Math.floor(totalMinutes / MIN_IN_YEAR);
    let remainder = totalMinutes % MIN_IN_YEAR;
    const months = Math.floor(remainder / MIN_IN_MONTH);
    remainder %= MIN_IN_MONTH;
    const days = Math.floor(remainder / MIN_IN_DAY);
    remainder %= MIN_IN_DAY;
    const hours = Math.floor(remainder / MIN_IN_HOUR);
    const minutes = remainder % MIN_IN_HOUR;
    const parts = [];
    if (years > 0) parts.push(`${years}a`);
    if (months > 0) parts.push(`${months}m`);
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}min`);
    if (parts.length === 0) return '0min';
    return parts.slice(0, 2).join(' ');
}

/**
 * Helper to convert a hex color string to an RGB string.
 * @param {string} hex - The hex color.
 * @returns {string} - The RGB color string "r, g, b".
 */
export function hexToRgb(hex: string): string {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0, 0, 0';
}

/**
 * Animates a number from a start value to an end value over a duration.
 * @param {HTMLElement} element - The element whose textContent will be updated.
 * @param {number} start - The starting number.
 * @param {number} end - The final number.
 * @param {number} duration - The animation duration in milliseconds.
 */
export function animateValue(element: HTMLElement, start: number, end: number, duration: number) {
    if (end === start) {
        element.textContent = end.toLocaleString('pt-PT');
        return;
    }
    const range = end - start;
    let startTime: number | null = null;
    function step(timestamp: number) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - (startTime as number)) / duration, 1);
        const currentValue = Math.floor(progress * range + start);
        element.textContent = currentValue.toLocaleString('pt-PT');
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            element.textContent = end.toLocaleString('pt-PT');
        }
    }
    window.requestAnimationFrame(step);
}

/**
 * Exports a Chart.js instance to a PNG image and triggers a download.
 * @param {Chart} chart - The Chart.js instance.
 * @param {string} filename - The desired filename for the downloaded image.
 */
export function exportChartToPNG(chart: Chart, filename: string): void {
    if (!chart) return;
    const url = chart.toBase64Image();
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/**
 * Converts an array of objects to a CSV string and triggers a download.
 * @param {Record<string, any>[]} data - The array of data objects.
 * @param {Record<string, string>} headers - An object mapping data keys to CSV header names.
 * @param {string} filename - The desired filename for the downloaded CSV file.
 */
export function exportDataToCSV(data: Record<string, any>[], headers: Record<string, string>, filename: string): void {
    if (!data || data.length === 0) return;

    const headerKeys = Object.keys(headers);
    const headerValues = Object.values(headers);

    const escapeCell = (cellValue: any): string => {
        let cell = cellValue === null || cellValue === undefined ? '' : String(cellValue);
        const needsQuotes = cell.includes(',') || cell.includes('\n') || cell.includes('"');
        if (needsQuotes) {
            cell = cell.replace(/"/g, '""'); // Escape double quotes
            cell = `"${cell}"`; // Wrap in double quotes
        }
        return cell;
    };

    const csvRows = [
        headerValues.join(','), // Header row
        ...data.map(row => headerKeys.map(key => escapeCell(row[key])).join(','))
    ];

    const csvString = csvRows.join('\n');
    const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Animates a duration in minutes and updates the element with a formatted string.
 * @param {HTMLElement} element - The element whose textContent will be updated.
 * @param {number} start - The starting number of minutes.
 * @param {number} end - The final number of minutes.
 * @param {number} duration - The animation duration in milliseconds.
 */
export function animateDuration(element: HTMLElement, start: number, end: number, duration: number) {
    if (end === start) {
        element.textContent = formatDuration(end);
        return;
    }
    const range = end - start;
    let startTime: number | null = null;
    function step(timestamp: number) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - (startTime as number)) / duration, 1);
        const currentValue = Math.floor(progress * range + start);
        element.textContent = formatDuration(currentValue);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            element.textContent = formatDuration(end);
        }
    }
    window.requestAnimationFrame(step);
}