# 🌐 Countries Catalog

Інтерактивний каталог країн на чистому **HTML / CSS / JavaScript** (без збірки, лише CDN-бібліотеки).

## ✨ Можливості

- **Інтерактивна карта світу** (D3.js + TopoJSON) — головна сторінка
  - підсвічування кордонів та спливаюча підказка з назвою і прапором при наведенні
  - повна інформація про країну при кліку (столиця, населення, цікаві факти)
  - масштабування та переміщення карти
- **Сітка країн** з прапорами — перемикається в навігації
- **Фільтр за континентом** через випадаючий список (спільний для карти й сітки)
- **Пошук** країн за назвою
- **Вікторина «Вгадай країну за прапором»** — 10 питань, 4 варіанти, два рівні складності, конфеті за правильні відповіді

## 🛠 Стек

- HTML5, CSS3, vanilla JavaScript
- [D3.js v7](https://d3js.org/) + [topojson-client](https://github.com/topojson/topojson-client) + [d3-geo-projection](https://github.com/d3/d3-geo-projection) — карта
- [REST Countries API](https://restcountries.com/) — дані про країни (з резервним джерелом mledoze/countries)
- [world-atlas](https://github.com/topojson/world-atlas) — геометрія карти
- [flagcdn.com](https://flagcdn.com/) — зображення прапорів
- [canvas-confetti](https://github.com/catdad/canvas-confetti) — анімація у вікторині

## 🚀 Запуск локально

Відкрий `index.html` у браузері — сервер не потрібен.

## 📁 Структура

```
├── index.html        # Головна: карта + сітка
├── quiz.html         # Сторінка вікторини
├── css/
│   ├── style.css
│   └── quiz.css
└── js/
    ├── app.js        # Карта, сітка, панель деталей, фільтри
    └── quiz.js       # Логіка вікторини
```
