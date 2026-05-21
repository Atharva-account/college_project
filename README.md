## Cloud-Based File Storage System (Flask + MongoDB GridFS)

### Prerequisites
- Python 3.10+
- MongoDB running locally or in the cloud

### Setup
1. Create and activate a virtual environment.
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Copy environment file and set values:
   - Copy `.env.example` to `.env` and adjust as needed.
4. Run the app:
   - `python app.py`

### API Endpoints
- `POST /upload` - multipart/form-data with `file`
- `GET /files` - list files
- `GET /download/<file_id>` - download by id
- `DELETE /delete/<file_id>` - delete by id

### Frontend
Open `http://localhost:5000/` to use the UI.


"# college_project" 
"# college_project" 
"# college_project" 
