# 🏡 Real Estate Listings Analyzer

A powerful tool for analyzing real estate listings and finding properties closest to health clinics or elementary schools. This tool integrates with Claude Desktop to provide intelligent property analysis without requiring programming skills.

## What is this tool?

This tool analyzes spreadsheets (CSV or Excel files) of real estate listings and helps you find the top properties closest to a health clinic or elementary school. It's designed to be smart, powerful, and easy to use—no programming needed.

## Prerequisites

Before you begin, ensure you have:

- **Claude Desktop** installed on your computer ([Download Claude Desktop](https://claude.ai/download))
- **The file `claude_desktop_config.json`** (it's inside this repository)
- **Your real estate listings file** (CSV or XLSX/Excel format)
- **A Google Maps API key** (ask your technical team if you don't have one)
- **Node.js and npm** installed (ask a technical colleague if you need help)

## Getting Started

### 1. Install Dependencies

Open a terminal or command prompt in your project folder and run:

```sh
npm install
```

This command installs all the necessary packages for your tool.

### 2. Create the Cache Folder

In your project folder (where the code files are), create a new folder named exactly:

```
places_cache
```

### 3. Create and Edit the .env File

In your project folder, create a new file named `.env` and paste:

```env
GOOGLE_API_KEY=PUT_YOR_GOOGLE_MAPS_API_KEY_HERE
```

Replace:
- `PUT_YOR_GOOGLE_MAPS_API_KEY_HERE` with your real Google Maps API key

### 4. Build the Project

Before using with Claude Desktop, you need to build (compile) the project:

```sh
npm run build
```

This creates a build folder with everything Claude needs. You should do this every time you update the code.

## Configuration

### Setting up claude_desktop_config.json

Before you can use the tool, you need to tell Claude Desktop where your project and your data are stored.

1. Open the file `claude_desktop_config.json` in Notepad or any text editor
2. Update the following fields:
   - Replace `/PATH/TO/SHEETS/FOLDER` with the actual folder path where your spreadsheet files are stored
   - Replace `/PATH/TO/PROJECT/FOLDER/madlan-home-task/build/index.js` with the full path to your project's MCP server index.js file (in the build folder)
   - Replace `PUT_YOR_GOOGLE_MAPS_API_KEY_HERE` with your actual Google Maps API key
3. Save the file after making these changes

### Import Configuration into Claude Desktop

1. Open Claude Desktop
2. Go to the "Plugins" or "Integrations" menu
3. Look for an "Import configuration" or "Load config file" button
4. Choose your updated `claude_desktop_config.json` file

**💡 Tip:** If you're not sure how to find the right folder paths, you can right-click on a folder in Windows Explorer or Finder (Mac) and choose "Copy as path", then paste the path in place of `/PATH/TO/...` in the config file.

## Usage

1. **Start a new chat** with Claude Desktop
2. **Attach your real estate listings file** (CSV or Excel)
3. **Type your request clearly**, for example:

```
using top-listings-by-poi-proximity provide me with the top 3 listings, below 2 million NIS, that have 3+ rooms and that also have the minimal distances from a health clinic.
```

or

```
using top-listings-by-poi-proximity show me the top 5 listings with at least 4 rooms, under 2.5 million NIS, closest to an elementary school.
```

4. **Wait** while the tool analyzes your file
5. **Review results** - Claude will reply with a table of the best listings, including distance to the nearest clinic or school, price, rooms, and other details

## Development Notes

### Why isn't the build folder in git?

The build folder is created automatically every time you run `npm run build`. It's excluded from the repository (using `.gitignore`) to keep your code clean. Everyone should run `npm install` and `npm run build` themselves after pulling new code.

## Troubleshooting

### Common Issues

**Q: My file isn't recognized.**
A: Make sure it's an Excel (.xlsx) or CSV (.csv) file, and that it has columns like `street`, `city`, `property_price`, and `property_rooms`.

**Q: Claude says "no listings were found."**
A: Check that your file uses the correct column headers and that your search isn't too strict (e.g., not too many rooms or too low a price).

**Q: Where should I put the claude_desktop_config.json file if I can't find the Plugins menu?**
A: Look for a folder named `plugins`, `integrations`, or `config` inside the Claude Desktop app's settings or application folder. If you're stuck, ask a colleague for help.

## Support

If you need more help, please contact your team's technical support, or create an issue in this repository with your question!

---

**You're ready to go!** Just upload your file, ask your question, and get your top listings instantly! 🚀