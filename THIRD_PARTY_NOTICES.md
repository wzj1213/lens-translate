# Third-party components

The PDF reader uses [Mozilla PDF.js](https://github.com/mozilla/pdf.js) under Apache-2.0. Its CMaps, fonts, ICC profile and image decoders include licenses from their respective authors. The ZIP includes them alongside the assets in `vendor/pdf/`.

Image recognition uses [Tesseract.js](https://github.com/naptha/tesseract.js) and [Tesseract.js-core](https://github.com/naptha/tesseract.js-core) under Apache-2.0. The bundled English, Simplified Chinese and Japanese recognition models are distributed by [tesseract.js-data](https://github.com/naptha/tessdata) from the [Tesseract language data](https://github.com/tesseract-ocr/tessdata_best) project (Apache-2.0). Their npm wrappers declare MIT. Licenses and browser bundle notices are included in `vendor/ocr/`.
