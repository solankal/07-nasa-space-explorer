// Find our date picker inputs on the page
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');

// Call the setupDateInputs function from dateRange.js
// This sets up the date pickers to:
// - Default to a range of 9 days (from 9 days ago to today)
// - Restrict dates to NASA's image archive (starting from 1995)
setupDateInputs(startInput, endInput);

const filters = document.getElementById('imageFilters');
const gallery = document.getElementById('gallery');
const statusMessage = document.getElementById('galleryStatus');
const modal = document.getElementById('photoModal');
const modalImage = document.getElementById('modalImage');
const modalTitle = document.getElementById('modalTitle');
const modalDate = document.getElementById('modalDate');
const modalExplanation = document.getElementById('modalExplanation');
const modalCredit = document.getElementById('modalCredit');
const closeModalButton = document.getElementById('closeModal');
const apiUrl = 'https://science.nasa.gov/wp-json/wp/v2/image-article';
const pageSize = 100;
let activeRequest;

// NASA includes HTML in some fields. Read it as text without inserting it into the page.
function plainText(value) {
	const documentWithText = new DOMParser().parseFromString(String(value || ''), 'text/html');
	return documentWithText.body.textContent.trim();
}

// NASA's APOD articles are available through its official WordPress feed as JSONP.
function loadArchivePage(parameters, signal) {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error('Request cancelled'));
			return;
		}

		const callbackName = `nasaApodCallback${Date.now()}${Math.random().toString(36).slice(2)}`;
		const script = document.createElement('script');
		let timeoutId;

		function cleanUp() {
			clearTimeout(timeoutId);
			script.remove();
			delete window[callbackName];
			signal.removeEventListener('abort', handleAbort);
		}

		function handleAbort() {
			cleanUp();
			reject(new Error('Request cancelled'));
		}

		window[callbackName] = (articles) => {
			cleanUp();
			if (articles && articles.code === 'rest_post_invalid_page_number') {
				resolve([]);
			} else if (Array.isArray(articles)) {
				resolve(articles);
			} else {
				reject(new Error('NASA returned an unexpected archive response.'));
			}
		};

		const query = new URLSearchParams(parameters);
		query.set('_jsonp', callbackName);
		script.async = true;
		script.referrerPolicy = 'no-referrer';
		script.src = `${apiUrl}?${query}`;
		script.onerror = () => {
			cleanUp();
			reject(new Error('Could not reach NASA\'s APOD archive.'));
		};

		signal.addEventListener('abort', handleAbort, { once: true });
		timeoutId = setTimeout(() => {
			cleanUp();
			reject(new Error('NASA\'s APOD archive took too long to respond.'));
		}, 20000);
		document.head.append(script);
	});
}

// The API is date-filtered by NASA article records; keep only APOD photo entries.
async function loadApodArticles(startDate, endDate, signal) {
	const dayAfterEnd = new Date(`${endDate}T00:00:00Z`);
	dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);
	const articles = [];
	let page = 1;

	while (page <= 10) {
		const pageArticles = await loadArchivePage({
			after: `${startDate}T00:00:00`,
			before: `${dayAfterEnd.toISOString().slice(0, 10)}T00:00:00`,
			per_page: String(pageSize),
			page: String(page),
			_fields: 'date,slug,title,content'
		}, signal);

		if (pageArticles.length === 0) break;
		articles.push(...pageArticles);
		if (pageArticles.length < pageSize) return articles;
		page += 1;
	}

	if (page > 10) throw new Error('Choose a shorter date range to search NASA\'s archive.');
	return articles;
}

function getApodPhoto(article) {
	const articleDocument = new DOMParser().parseFromString(article.content?.rendered || '', 'text/html');
	const image = Array.from(articleDocument.querySelectorAll('img')).find((candidate) => {
		const source = candidate.getAttribute('src');
		if (!source) return false;

		try {
			const imageUrl = new URL(source);
			return imageUrl.protocol === 'https:' &&
				imageUrl.hostname === 'assets.science.nasa.gov' &&
				imageUrl.pathname.includes('/science/cds/apod/apod/');
		} catch {
			return false;
		}
	});

	if (!image) return null;

	const articleText = articleDocument.body.textContent.replace(/\s+/g, ' ').trim();
	const explanationStart = articleText.indexOf('Explanation:');
	let explanation = '';
	if (explanationStart >= 0) {
		const explanationText = articleText.slice(explanationStart + 'Explanation:'.length);
		const explanationEnd = explanationText.search(/Tomorrow['\u2019]s picture:|Date:/);
		explanation = (explanationEnd >= 0 ? explanationText.slice(0, explanationEnd) : explanationText).trim();
	}

	const creditStart = articleText.indexOf('Credit:');
	let credit = '';
	if (creditStart >= 0) {
		const creditText = articleText.slice(creditStart + 'Credit:'.length);
		const creditEnd = creditText.search(/Authors editors:|A service of:/);
		credit = (creditEnd >= 0 ? creditText.slice(0, creditEnd) : creditText).trim();
	}

	const imageUrl = new URL(image.getAttribute('src'));
	const title = plainText(article.title?.rendered).replace(/^APOD:\s*.*?[\u2013\u2014-]\s*/, '');
	return {
		date: article.date.slice(0, 10),
		title: title || image.alt || 'Astronomy Picture of the Day',
		alt: image.alt,
		url: imageUrl.href,
		explanation,
		credit
	};
}

// Use a local date so time zones do not shift a photo to the previous day.
function formatDate(date) {
	return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
		year: 'numeric', month: 'long', day: 'numeric'
	});
}

function openPhoto(photo) {
	modalImage.src = photo.hdurl || photo.url;
	modalImage.alt = plainText(photo.alt || photo.title);
	modalTitle.textContent = plainText(photo.title);
	modalDate.textContent = formatDate(photo.date);
	modalDate.dateTime = photo.date;
	modalExplanation.textContent = plainText(photo.explanation);
	const credit = plainText(photo.credit || photo.copyright);
	modalCredit.textContent = credit ? `Image credit: ${credit}` : '';
	modal.showModal();
}

function displayPhotos(photos) {
	gallery.replaceChildren();

	photos.forEach((photo) => {
		const item = document.createElement('button');
		item.type = 'button';
		item.className = 'gallery-item';
		// Keep the markup simple, and set API values with textContent below for safety.
		item.innerHTML = `
			<span class="image-frame"><img loading="lazy" decoding="async" /></span>
			<span class="photo-title"></span>
			<time class="photo-date"></time>
		`;
		const image = item.querySelector('img');
		image.src = photo.hdurl || photo.url;
		image.alt = plainText(photo.alt || photo.title);
		image.addEventListener('error', () => {
			const message = document.createElement('span');
			message.className = 'image-unavailable';
			message.textContent = 'Image unavailable';
			image.replaceWith(message);
		});
		item.querySelector('.photo-title').textContent = plainText(photo.title);
		const date = item.querySelector('time');
		date.textContent = formatDate(photo.date);
		date.dateTime = photo.date;
		item.addEventListener('click', () => openPhoto(photo));
		gallery.append(item);
	});
}

filters.addEventListener('submit', async (event) => {
	event.preventDefault();
	if (!filters.reportValidity()) return;
	const startDate = startInput.value;
	const endDate = endInput.value;
	if (startDate > endDate) {
		statusMessage.textContent = 'Choose an end date on or after the start date.';
		return;
	}
	const rangeInDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000;
	if (rangeInDays > 99) {
		statusMessage.textContent = 'Choose a date range of 100 days or less.';
		return;
	}

	// Cancel an older search so it cannot overwrite the latest date range.
	if (activeRequest) activeRequest.abort();
	const request = new AbortController();
	activeRequest = request;
	gallery.replaceChildren();
	gallery.setAttribute('aria-busy', 'true');
	statusMessage.textContent = 'Loading space photos...';

	try {
		const articles = await loadApodArticles(startDate, endDate, request.signal);

		if (request.signal.aborted) return;
		const images = articles
			.filter((article) => article.slug.startsWith('apod-'))
			.map(getApodPhoto)
			.filter((photo) => photo && photo.date >= startDate && photo.date <= endDate);
		images.sort((first, second) => second.date.localeCompare(first.date));
		displayPhotos(images);
		statusMessage.textContent = images.length
			? `${images.length} APOD ${images.length === 1 ? 'photo' : 'photos'}`
			: 'No APOD photos were found for these dates. Some dates may have a video instead of a photo.';
	} catch (error) {
		if (request.signal.aborted) return;
		statusMessage.textContent = `Could not load NASA's APOD archive: ${error.message}`;
		console.error(error);
	} finally {
		if (activeRequest === request) gallery.setAttribute('aria-busy', 'false');
	}
});

// A native dialog handles Escape, keyboard focus, and returning focus to the photo.
closeModalButton.addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => {
	const bounds = modal.getBoundingClientRect();
	const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
		event.clientY < bounds.top || event.clientY > bounds.bottom;
	if (event.target === modal && outside) modal.close();
});
