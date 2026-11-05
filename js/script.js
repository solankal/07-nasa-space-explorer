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
const apiUrl = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic';
let activeRequest;

// NASA includes HTML in some fields. Read it as text without inserting it into the page.
function plainText(value) {
	const documentWithText = new DOMParser().parseFromString(String(value || ''), 'text/html');
	return documentWithText.body.textContent.trim();
}

// Use a local date so time zones do not shift a photo to the previous day.
function formatDate(date) {
	return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
		year: 'numeric', month: 'long', day: 'numeric'
	});
}

function openPhoto(photo) {
	modalImage.src = photo.hdurl;
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
		image.src = photo.hdurl;
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

	// Cancel an older search so it cannot overwrite the latest date range.
	if (activeRequest) activeRequest.abort();
	const request = new AbortController();
	activeRequest = request;
	gallery.replaceChildren();
	gallery.setAttribute('aria-busy', 'true');
	statusMessage.textContent = 'Loading space photos...';

	try {
		const photos = [];
		let page = 1;
		let morePages = true;

		// The API returns pages of results. Keep fetching until the date range is complete.
		while (morePages) {
			const parameters = new URLSearchParams({
				date_from: startDate,
				date_to: endDate,
				per_page: '100',
				page: `${page}`
			});
			const response = await fetch(`${apiUrl}?${parameters}`, { signal: request.signal });
			if (!response.ok) throw new Error(`NASA request failed: ${response.status}`);
			const data = await response.json();
			if (!Array.isArray(data)) throw new Error('Unexpected NASA response');
			photos.push(...data);
			morePages = data.length === 100;
			page += 1;
		}

		if (request.signal.aborted) return;
		// Some APOD entries are videos rather than photos, so only show usable images.
		const images = photos.filter((photo) =>
			photo.media_type === 'image' &&
			typeof photo.hdurl === 'string' &&
			photo.hdurl.startsWith('https://') &&
			photo.date >= startDate && photo.date <= endDate
		);
		images.sort((first, second) => second.date.localeCompare(first.date));
		displayPhotos(images);
		statusMessage.textContent = images.length
			? `${images.length} space ${images.length === 1 ? 'photo' : 'photos'}`
			: 'No space photos were found for these dates. Try another date range.';
	} catch (error) {
		if (request.signal.aborted) return;
		statusMessage.textContent = 'Unable to load space photos. Please check your connection and try again.';
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
