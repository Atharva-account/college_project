import os
import secrets
import datetime as datetime_

from datetime import datetime, timezone
from functools import wraps
from io import BytesIO

from bson import ObjectId
from bson.errors import InvalidId

from dotenv import load_dotenv
from flask import (
    Flask,
    jsonify,
    request,
    send_file,
    render_template,
    redirect,
    url_for,
    session,
    flash,
)

from flask_cors import CORS
from pymongo import MongoClient
from gridfs import GridFS

import werkzeug.security


load_dotenv()


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")

    # Enable CORS for all routes (adjust origins for production)
    CORS(app)

    mongo_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    mongo_db_name = os.getenv("MONGODB_DB", "cloud_storage")
    app.secret_key = os.getenv("SECRET_KEY", "dev-secret-key-change")

    try:
       client = MongoClient(
        mongo_uri,
        serverSelectionTimeoutMS=5000
       )

       client.admin.command("ping")

       print("MongoDB connected successfully")

    except Exception as e:
       print("MongoDB connection failed")
       print(e)
    db = client[mongo_db_name]
    fs = GridFS(db)
    users = db["users"]
    shares = db["shares"]

    def login_required(view_func):
        @wraps(view_func)
        def wrapper(*args, **kwargs):
            if not session.get("user_id"):
                return redirect(url_for("login", next=request.path))
            return view_func(*args, **kwargs)
        return wrapper

    @app.route("/")
    def home():
        if session.get("user_id"):
            return redirect(url_for("dashboard"))
        return render_template("landing.html")

    @app.get("/dashboard")
    @login_required
    def dashboard():
        return render_template("index.html", user_email=session.get("user_email"))

    @app.get("/signup")
    def signup():
        if session.get("user_id"):
            return redirect(url_for("dashboard"))
        return render_template("signup.html")

    @app.post("/signup")
    def signup_post():
        data = request.form
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        if not email or not password:
            flash("Email and password are required", "danger")
            return redirect(url_for("signup"))
        existing = users.find_one({"email": email})
        if existing:
            flash("Email already registered", "warning")
            return redirect(url_for("signup"))
        users.insert_one({
            "email": email,
            "password_hash": werkzeug.security.generate_password_hash(password),
            "createdAt": datetime.utcnow(),
        })
        flash("Account created. Please log in.", "success")
        return redirect(url_for("login"))

    @app.get("/login")
    def login():
        if session.get("user_id"):
            return redirect(url_for("dashboard"))
        return render_template("login.html")

    @app.post("/login")
    def login_post():
        data = request.form
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        user = users.find_one({"email": email})
        if not user or not werkzeug.security.check_password_hash(user.get("password_hash", ""), password):
            flash("Invalid email or password", "danger")
            return redirect(url_for("login"))
        session["user_id"] = str(user["_id"])
        session["user_email"] = user["email"]
        next_url = request.args.get("next") or url_for("dashboard")
        return redirect(next_url)

    @app.post("/logout")
    def logout():
        session.clear()
        return redirect(url_for("home"))

    @app.post("/upload")
    @login_required
    def upload_file():
        if "file" not in request.files:
            return jsonify({"error": "No file part in the request"}), 400

        uploaded_file = request.files["file"]
        if uploaded_file.filename == "":
            return jsonify({"error": "No selected file"}), 400

        metadata = {
            "contentType": uploaded_file.mimetype,
            "uploadedAt": datetime.utcnow(),
            "ownerId": session.get("user_id"),
        }

        file_id = fs.put(
            uploaded_file.stream,
            filename=uploaded_file.filename,
            contentType=uploaded_file.mimetype,
            metadata=metadata,
        )

        return jsonify({"id": str(file_id), "filename": uploaded_file.filename}), 201

    @app.get("/files")
    @login_required
    def list_files():
        files = []
        owner_id = session.get("user_id")
        for f in db.fs.files.find({"metadata.ownerId": owner_id}).sort("uploadDate", -1):
            files.append(
                {
                    "id": str(f.get("_id")),
                    "filename": f.get("filename"),
                    "length": f.get("length"),
                    "chunkSize": f.get("chunkSize"),
                    "uploadDate": f.get("uploadDate"),
                    "md5": f.get("md5"),
                    "contentType": f.get("contentType"),
                }
            )
        return jsonify(files)

    @app.get("/download/<file_id>")
    @login_required
    def download_file(file_id: str):
        try:
            oid = ObjectId(file_id)
        except (InvalidId, TypeError):
            return jsonify({"error": "Invalid file id"}), 400

        grid_out = fs.get(oid)
        meta = getattr(grid_out, "metadata", {}) or {}
        if meta.get("ownerId") != session.get("user_id"):
            return jsonify({"error": "Not found"}), 404
        data = grid_out.read()
        return send_file(
            BytesIO(data),
            mimetype=grid_out.content_type or "application/octet-stream",
            as_attachment=True,
            download_name=grid_out.filename,
        )

    @app.delete("/delete/<file_id>")
    @login_required
    def delete_file(file_id: str):
        try:
            oid = ObjectId(file_id)
        except (InvalidId, TypeError):
            return jsonify({"error": "Invalid file id"}), 400

        try:
            grid_out = fs.get(oid)
            meta = getattr(grid_out, "metadata", {}) or {}
            if meta.get("ownerId") != session.get("user_id"):
                return jsonify({"error": "Not found"}), 404
            fs.delete(oid)
        except Exception:
            return jsonify({"error": "File not found"}), 404

        return jsonify({"status": "deleted", "id": file_id})

    @app.post("/share/<file_id>")
    @login_required
    def create_share_link(file_id: str):
        try:
            oid = ObjectId(file_id)
        except (InvalidId, TypeError):
            return jsonify({"error": "Invalid file id"}), 400

        # Verify file exists and belongs to user
        try:
            grid_out = fs.get(oid)
            meta = getattr(grid_out, "metadata", {}) or {}
            if meta.get("ownerId") != session.get("user_id"):
                return jsonify({"error": "Not found"}), 404
        except Exception:
            return jsonify({"error": "File not found"}), 404

        # Create share token
        share_token = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + datetime_.timedelta(days=7)

        shares.insert_one({
            "token": share_token,
            "fileId": file_id,
            "ownerId": session.get("user_id"),
            "createdAt": datetime.utcnow(),
            "expiresAt": expires_at,
        })

        share_url = f"{request.host_url.rstrip('/')}/shared/{share_token}"
        return jsonify({
            "shareUrl": share_url,
            "token": share_token,
            "expiresAt": expires_at.isoformat()
        })

    @app.get("/shared/<token>")
    def download_shared_file(token: str):
        share = shares.find_one({"token": token})
        if not share:
            return render_template("shared.html", valid=False)

        # Check expiration
        if datetime.utcnow() > share.get("expiresAt", datetime.utcnow()):
            return render_template("shared.html", valid=False)

        # Handle actual download
        if request.args.get("download") == "1":
            try:
                oid = ObjectId(share["fileId"])
                grid_out = fs.get(oid)
            except Exception:
                return jsonify({"error": "File not found"}), 404

            data = grid_out.read()
            return send_file(
                BytesIO(data),
                mimetype=grid_out.content_type or "application/octet-stream",
                as_attachment=True,
                download_name=grid_out.filename,
            )

        # Show download page
        try:
            oid = ObjectId(share["fileId"])
            grid_out = fs.get(oid)
            
            # Get file icon based on filename
            filename = grid_out.filename or ""
            extension = filename.split('.')[-1].lower() if '.' in filename else ""
            
            icon_map = {
                'pdf': ('file-earmark-pdf', '#ef4444'),
                'doc': ('file-earmark-word', '#3b82f6'),
                'docx': ('file-earmark-word', '#3b82f6'),
                'xls': ('file-earmark-excel', '#10b981'),
                'xlsx': ('file-earmark-excel', '#10b981'),
                'ppt': ('file-earmark-slides', '#f59e0b'),
                'pptx': ('file-earmark-slides', '#f59e0b'),
                'jpg': ('file-earmark-image', '#f59e0b'),
                'jpeg': ('file-earmark-image', '#f59e0b'),
                'png': ('file-earmark-image', '#f59e0b'),
                'gif': ('file-earmark-image', '#f59e0b'),
                'mp4': ('file-earmark-play', '#8b5cf6'),
                'mp3': ('file-earmark-music', '#ec4899'),
                'zip': ('file-earmark-zip', '#6b7280'),
            }
            
            icon_class, icon_color = icon_map.get(extension, ('file-earmark', '#9ca3af'))
            
            # Format file size
            size = grid_out.length
            if size < 1024:
                file_size = f"{size} B"
            elif size < 1024 * 1024:
                file_size = f"{size / 1024:.1f} KB"
            else:
                file_size = f"{size / (1024 * 1024):.2f} MB"
            
            return render_template("shared.html", 
                valid=True,
                token=token,
                filename=grid_out.filename,
                file_size=file_size,
                content_type=grid_out.content_type or "Unknown",
                icon_class=icon_class,
                icon_color=icon_color
            )
        except Exception:
            return render_template("shared.html", valid=False)

    @app.get("/profile")
    @login_required
    def profile():
        return render_template("profile.html", user_email=session.get("user_email"))

    @app.get("/payment")
    @login_required
    def payment_page():
        return render_template("payment.html")

    @app.post("/process-payment")
    @login_required
    def process_payment():
        data = request.get_json() or {}
        plan = data.get("plan", "pro")
        amount = data.get("amount", 0)
        
        # Define storage limits for each plan
        plan_limits = {
            "pro": 10 * 1024 * 1024 * 1024,  # 10 GB
            "business": 100 * 1024 * 1024 * 1024  # 100 GB
        }
        
        storage_limit = plan_limits.get(plan, 10 * 1024 * 1024 * 1024)
        
        # Update user's subscription in database
        users.update_one(
            {"_id": ObjectId(session.get("user_id"))},
            {
                "$set": {
                    "subscription": {
                        "plan": plan,
                        "storageLimit": storage_limit,
                        "upgradedAt": datetime.utcnow(),
                        "amount": amount
                    }
                }
            }
        )
        
        return jsonify({
            "success": True,
            "plan": plan,
            "storageLimit": storage_limit,
            "message": f"Upgraded to {plan} plan successfully!"
        })

    @app.get("/stats")
    @login_required
    def get_user_stats():
        owner_id = session.get("user_id")
        
        # Get user data to check for upgraded storage limit
        user = users.find_one({"_id": ObjectId(owner_id)})
        subscription = user.get("subscription", {}) if user else {}
        
        # Use upgraded storage limit if available, otherwise default to 1 GB
        storage_limit = subscription.get("storageLimit", 1024 * 1024 * 1024)  # 1 GB default
        
        # Calculate total storage used
        total_size = 0
        file_count = 0
        for f in db.fs.files.find({"metadata.ownerId": owner_id}):
            total_size += f.get("length", 0)
            file_count += 1
        
        # Count shared files
        shared_count = shares.count_documents({"ownerId": owner_id})
        
        return jsonify({
            "totalSize": total_size,
            "fileCount": file_count,
            "sharedCount": shared_count,
            "storageLimit": storage_limit,
            "usagePercent": round((total_size / storage_limit) * 100, 1) if storage_limit > 0 else 0,
            "plan": subscription.get("plan", "free")
        })

    @app.get("/health")
    def health():
        try:
            # This will raise if the server is unavailable
            db.command("ping")
            return jsonify({"status": "ok"})
        except Exception as exc:
            return jsonify({"status": "error", "message": str(exc)}), 500

    return app


if __name__ == "__main__":
    app = create_app()
    port = int(os.getenv("PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)


