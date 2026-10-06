Vendored for offline, in-browser OCR (photo → grocery items). Loaded lazily, only when "Add from photo" is used.
- tesseract.min.js, worker.min.js: tesseract.js 7.0.0 (Apache-2.0) https://github.com/naptha/tesseract.js
- core/tesseract-core-{simd-lstm,lstm}.wasm.js: tesseract.js-core 7.0.0 (Apache-2.0), LSTM-only builds (SIMD + non-SIMD fallback)
- lang/eng.traineddata.gz: English LSTM model "4.0.0_best_int" from @tesseract.js-data/eng 1.0.0 (Apache-2.0, from tesseract-ocr/tessdata)
