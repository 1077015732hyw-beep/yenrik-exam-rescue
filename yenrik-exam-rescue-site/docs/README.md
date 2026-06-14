# Exam Rescue

Exam Rescue is a pure static GitHub Pages site for sharing university exam review resources.

## Deploy Path

All static references use the project base path:

```text
/yenrik-exam-rescue/
```

Example:

```text
/yenrik-exam-rescue/css/style.css
/yenrik-exam-rescue/js/app.js
/yenrik-exam-rescue/pdf/advanced-math/final-review.pdf
```

## Data

- Subjects: `/data/subjects.json`
- Resources: `/data/resources.json`
- Updates: `/data/updates.json`
- Announcements: `/data/announcements.json`

The HTML files do not hard-code subject or resource cards. They render from the JSON files in the browser.
